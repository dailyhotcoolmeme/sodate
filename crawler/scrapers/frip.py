"""프립 (frip.co.kr) 스크래퍼 — GraphQL API 기반 (상세 데이터 수집)

수집 전략:
1. ListingProductV4 API로 소개팅 카테고리 상품 목록 수집
2. 각 상품에 대해 GetFirstPurchasableSchedule + GetSelectItems 호출 → 남/여 잔여석·가격·정원
3. GetProductDetailPageData 호출 → description(contents) + frip.recommendedAge
4. description HTML 파싱 → participant_stats, age_group_label, age_range_min/max
"""

import re
import html as html_module
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month
from utils.region import resolve_region

FRIP_GQL = 'https://gql.frip.co.kr/graphql'
FRIP_BASE = 'https://frip.co.kr'

# 소개팅 관련 카테고리 ID
#   2841=소셜/게더링(파티성), 2834=미팅(12대12 로테이션 소개팅 등 핵심), 2844=파티
# 과거 2841만 봐서 미팅(2834) 카테고리 전체(로테이션 소개팅 다수)를 놓쳤음.
# 술19금(2392)은 순수 음주 클래스 노이즈 우려로 제외. source_url로 중복 제거됨.
CATEGORY_IDS = [2841, 2834, 2844]

PRICE_RE = re.compile(r'[\d.]+')
REGION_KW = ['강남', '서초', '홍대', '신촌', '잠실', '건대', '성수', '이태원', '합정', '여의도',
             '마포', '종로', '용산', '동작', '관악', '수원', '인천', '부산', '대구', '대전']

# 예약옵션 이름에 지점이 박혀있는 업체(어바웃와인 등) — 일정별 지역을 옵션이름에서 추출.
# 통합상품(건대잠실합정)도 일정마다 옵션이름이 "건대…"/"잠실…"이라 지점별로 정확히 나뉨.
VENUE_KW = ['자양', '건대', '잠실', '송리단', '합정', '홍대', '신논현', '강남', '서초', '신촌',
            '성수', '종로', '을지로', '사당', '수원', '문래', '청담', '압구정', '신림', '당산',
            '서울대입구', '용산', '일산', '판교', '분당', '인천', '부산']

# 중복 제거용 지역 정규화 — 같은 물리적 지점의 다른 표기를 하나로 묶어(통합상품↔지점상품
# 겹침 제거). 저장 지역은 그대로 두고, dedup 키에서만 이 정규화를 씀.
_CANON_REGION = {
    '합정': '홍대', '마포': '홍대', '마포·서대문·은평': '홍대', '서대문': '홍대',
    '송리단': '잠실', '송파·강동': '잠실', '송파': '잠실', '강동': '잠실',
    '자양': '건대', '성동·광진': '건대', '성동': '건대', '광진': '건대',
    '서초': '강남', '강남·서초': '강남', '신논현': '강남', '청담': '강남', '압구정': '강남', '역삼': '강남',
}


def _canon_region(r):
    return _CANON_REGION.get(r, r)

# 나이대 패턴
AGE_RANGE_RE = re.compile(r'(\d{2})[~\-～](\d{2})년생')
# 나이 단독 패턴 (예: "30대", "20~30대")
AGE_DECADE_RE = re.compile(r'(\d{2})대')

GQL_HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Origin': 'https://frip.co.kr',
    'Referer': 'https://frip.co.kr/',
}

# ─── GraphQL 쿼리 정의 ────────────────────────────────────────────────────────

GQL_LIST_QUERY = '''
query ProductContainer($filter: ListingProductFilterV4, $size: Int, $page: Int) {
  product {
    listingProductsV4(size: $size, page: $page, filter: $filter) {
      pageInfo { hasNextPage }
      totalCount
      edges {
        node {
          id
          title
          areaName
          salePrice
          scheduleFirstDate
          headerContents {
            content {
              thumbnail(width: 500, height: 500, crop: FILL, fetchFormat: AUTO)
            }
          }
        }
      }
    }
  }
}
'''

GQL_SCHEDULE_QUERY = '''
query GetFirstPurchasableSchedule($id: ID!) {
  product {
    product(id: $id) {
      firstPurchasableSchedule {
        id
        status
        counts {
          quota
          remains
          sale
        }
        term {
          startedAt
          endedAt
        }
        saleTerm {
          endedAt
        }
      }
    }
  }
}
'''

GQL_SELECT_ITEMS_QUERY = '''
query GetSelectItems($productId: ID!, $scheduleId: ID, $selections: [String!]!) {
  product {
    selectItems(productId: $productId, scheduleId: $scheduleId, selections: $selections) {
      id
      item {
        id
        name
        price { retail sale }
        status
      }
      name
      quota
      remains
      status
      title
    }
  }
}
'''

GQL_DETAIL_QUERY = '''
query GetProductDetailPageData($id: ID!) {
  product {
    product(id: $id) {
      id
      title
      contents {
        content
      }
      frip {
        recommendedAge
        difficulty
      }
      period {
        startedAt
        endedAt
      }
    }
  }
}
'''

# 상품의 월별 전체 일정(반복 일정 업체=어바웃와인 등 핵심). 상품당 1일정만 보던
# firstPurchasableSchedule 한계를 해결 — 예약창의 "날짜 변경"이 쓰는 쿼리.
GQL_SCHEDULES_QUERY = '''
query GetSchedules($productId: ID!, $yearMonth: String) {
  product {
    schedulesByYearMonth(productId: $productId, statusIn: [OPENED, SOLD_OUT], yearMonth: $yearMonth) {
      schedules {
        id
        status
        counts { quota remains sale }
        term { startedAt endedAt }
        waitingInfo { isWaiting }
      }
    }
  }
}
'''


class FripScraper(BaseScraper):
    def __init__(self):
        super().__init__('frip')

    def scrape(self) -> list[EventModel]:
        events = []
        try:
            nodes = self._fetch_all_products()
            self.logger.info(f'프립 상품 {len(nodes)}개 수집')

            with httpx.Client(timeout=20) as client:
                for node in nodes:
                    events.extend(self._product_to_events(node, client))
        except Exception as e:
            self.logger.error(f'프립 크롤링 실패: {e}')

        # (지역+정확한 일시)로 중복 제거 — 통합상품(건대잠실합정)과 지점상품이 같은
        # 지점·날짜·시간 이벤트를 각각 내므로 겹침. 나이 있는 쪽을 우선 보존.
        best: dict = {}
        for ev in events:
            key = (_canon_region(ev.location_region), int(ev.event_date.timestamp()))
            cur = best.get(key)
            if cur is None or (ev.age_range_min and not cur.age_range_min):
                best[key] = ev
        unique = list(best.values())
        filtered = []
        for ev in unique:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'프립 총 {len(filtered)}개 이벤트 (필터 전: {len(unique)}개)')
        return filtered

    # ─── 목록 수집 ─────────────────────────────────────────────────────────────

    def _fetch_all_products(self) -> list[dict]:
        nodes: list[dict] = []
        page = 1
        with httpx.Client(timeout=20) as client:
            while True:
                variables = {
                    'filter': {'categoryIds': CATEGORY_IDS, 'orderType': 'LATEST'},
                    'size': 24,
                    'page': page,
                }
                resp = client.post(
                    FRIP_GQL,
                    json={'operationName': 'ProductContainer', 'query': GQL_LIST_QUERY, 'variables': variables},
                    headers=GQL_HEADERS,
                )
                resp.raise_for_status()
                data = resp.json()
                lp = data['data']['product']['listingProductsV4']
                nodes.extend(e['node'] for e in lp['edges'])
                if not lp['pageInfo']['hasNextPage']:
                    break
                page += 1
        return nodes

    # ─── 스케줄 + selectItems 조회 ──────────────────────────────────────────────

    def _fetch_schedule(self, product_id: str, client: httpx.Client) -> Optional[dict]:
        """firstPurchasableSchedule 조회"""
        try:
            resp = client.post(
                FRIP_GQL,
                json={
                    'operationName': 'GetFirstPurchasableSchedule',
                    'query': GQL_SCHEDULE_QUERY,
                    'variables': {'id': product_id},
                },
                headers=GQL_HEADERS,
            )
            resp.raise_for_status()
            d = resp.json()
            data = d.get('data') or {}
            fps = (data.get('product') or {}).get('product') or {}
            return fps.get('firstPurchasableSchedule')
        except Exception as e:
            self.logger.debug(f'스케줄 조회 실패 {product_id}: {e}')
            return None

    def _fetch_select_items(
        self, product_id: str, schedule_id: Optional[str], client: httpx.Client
    ) -> list[dict]:
        """selectItems 조회 (scheduleId 포함/미포함 모두 시도)"""
        try:
            resp = client.post(
                FRIP_GQL,
                json={
                    'operationName': 'GetSelectItems',
                    'query': GQL_SELECT_ITEMS_QUERY,
                    'variables': {
                        'productId': product_id,
                        'scheduleId': schedule_id,
                        'selections': [],
                    },
                },
                headers=GQL_HEADERS,
            )
            resp.raise_for_status()
            d = resp.json()
            data = d.get('data')
            if data:
                return (data.get('product') or {}).get('selectItems') or []
        except Exception as e:
            self.logger.debug(f'selectItems 조회 실패 {product_id}: {e}')
        return []

    def _fetch_detail(self, product_id: str, client: httpx.Client) -> Optional[dict]:
        """상품 상세 데이터 조회 (contents + frip.recommendedAge)"""
        try:
            resp = client.post(
                FRIP_GQL,
                json={
                    'operationName': 'GetProductDetailPageData',
                    'query': GQL_DETAIL_QUERY,
                    'variables': {'id': product_id},
                },
                headers=GQL_HEADERS,
            )
            resp.raise_for_status()
            d = resp.json()
            data = d.get('data') or {}
            return (data.get('product') or {}).get('product')
        except Exception as e:
            self.logger.debug(f'상품 상세 조회 실패 {product_id}: {e}')
            return None

    # ─── 파싱 유틸리티 ──────────────────────────────────────────────────────────

    @staticmethod
    def _html_to_text(html_str: str) -> str:
        """HTML 태그 제거 후 plain text 반환"""
        # HTML 엔티티 디코딩
        text = html_module.unescape(html_str)
        # 태그 제거
        text = re.sub(r'<[^>]+>', ' ', text)
        # 연속 공백/줄바꿈 정리
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def _fetch_schedules_multi(self, product_id: str, client: httpx.Client) -> list[dict]:
        """상품의 이번달~다음2달 전체 일정 조회(schedulesByYearMonth). 미래 일정만 반환.
        반환: [{'id','startedAt'(ms), 'remains','quota','isWaiting'}] 시간순."""
        out = []
        now_kst = datetime.now(timezone(timedelta(hours=9)))
        yms = set()
        for i in range(3):  # 이번달 + 2달
            m = now_kst.month + i
            y = now_kst.year + (m - 1) // 12
            m = (m - 1) % 12 + 1
            yms.add(f'{y}-{m:02d}')
        for ym in sorted(yms):
            try:
                resp = client.post(FRIP_GQL, json={
                    'operationName': 'GetSchedules', 'query': GQL_SCHEDULES_QUERY,
                    'variables': {'productId': product_id, 'yearMonth': ym}}, headers=GQL_HEADERS)
                resp.raise_for_status()
                days = ((resp.json().get('data') or {}).get('product') or {}).get('schedulesByYearMonth') or []
                for day in days:
                    for s in (day.get('schedules') or []):
                        term = s.get('term') or {}
                        st = term.get('startedAt')
                        if not st:
                            continue
                        counts = s.get('counts') or {}
                        out.append({
                            'id': s.get('id'), 'startedAt': int(st),
                            'remains': counts.get('remains'), 'quota': counts.get('quota'),
                            'isWaiting': (s.get('waitingInfo') or {}).get('isWaiting'),
                        })
            except Exception as e:
                self.logger.debug(f'월별 일정 조회 실패 {product_id} {ym}: {e}')
        # 중복 제거(같은 id) + 시간순
        uniq = {s['id']: s for s in out if s['id']}
        return sorted(uniq.values(), key=lambda s: s['startedAt'])

    def _parse_age_from_items(self, select_items: list[dict]) -> tuple:
        """selectItems 이름들에서 나이대(만나이) 추출 → 전체 합집합(min~max).
        '(28-37세)'→28~37, '[87-02년생]'→년생 환산, '(30대)'→30~39.
        여러 옵션에 서로 다른 티어(88-93/94-00년생 등)면 전부 아울러 범위 산출."""
        yr = datetime.now().year
        los, his = [], []
        for item in select_items:
            name = item.get('name', '') or ''
            m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*세', name)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                los.append(min(a, b)); his.append(max(a, b)); continue
            m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*년생', name)
            if m:
                y1, y2 = int(m.group(1)), int(m.group(2))
                b1 = (1900 + y1) if y1 >= 50 else (2000 + y1)
                b2 = (1900 + y2) if y2 >= 50 else (2000 + y2)
                los.append(yr - max(b1, b2)); his.append(yr - min(b1, b2)); continue
            d = re.search(r'(?<!\d)(\d0)대', name)  # 30대→30~39 ('2030 대화' 오매칭 방지)
            if d:
                base = int(d.group(1))
                los.append(base); his.append(base + 9)
        if los:
            return (max(18, min(los)), min(60, max(his)))
        return (None, None)

    def _parse_location_from_items(self, select_items: list[dict]) -> Optional[str]:
        """예약옵션 이름에서 지점 추출(어바웃와인 등). 통합상품(건대잠실합정)도 일정마다
        옵션이름이 '건대…'/'잠실…'이라 지점별로 정확히 나뉨. 없으면 None."""
        for it in select_items:
            name = it.get('name') or ''
            for kw in VENUE_KW:
                if kw in name:
                    return kw
        return None

    def _parse_age_smart(self, select_items: list[dict], title: str,
                         description: str, recommended_age: Optional[int] = None) -> tuple:
        """일정 나이 → (min, max, label). label 있으면 그 문자열을 '그대로 표시'(예 '2030'),
        None이면 'min~max세'로 표시. 필터는 항상 숫자 min/max로 건다.
        우선순위: 1)옵션이름 '28-37세/[87-02년생]/30대'(일정별·숫자표시) 2)년생(숫자표시)
        3)'N세 이하/이상'(숫자표시) 4)'2030/3040/2040'(그대로표시) 5)'N0대'(그대로표시)."""
        a = self._parse_age_from_items(select_items)
        if a[0]:
            return (a[0], a[1], None)
        yr = datetime.now().year

        def yrs_to_age(y1, y2):
            b1 = (1900 + y1) if y1 >= 50 else (2000 + y1)
            b2 = (1900 + y2) if y2 >= 50 else (2000 + y2)
            lo, hi = yr - max(b1, b2), yr - min(b1, b2)
            return (max(18, lo), min(60, hi)) if lo <= hi else None

        for text in (title or '', description or ''):
            m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*년생', text) \
                or re.search(r'(\d{2})\s*년생\s*[-~]\s*(\d{2})\s*년생', text)
            if m:
                r = yrs_to_age(int(m.group(1)), int(m.group(2)))
                if r:
                    return (r[0], r[1], None)
        # 'N세 이하/이상' (상·하한 단독)
        floor = recommended_age if (recommended_age and recommended_age >= 18) else 20
        for text in (title or '', description or ''):
            m = re.search(r'만?\s*(\d{2})\s*세\s*이하', text)
            if m:
                return (min(floor, int(m.group(1))), min(60, int(m.group(1))), None)
            m = re.search(r'만?\s*(\d{2})\s*세\s*이상', text)
            if m:
                return (max(18, int(m.group(1))), 49, None)
        # '2030/3040/2040' 밴드 — 그대로 표시(label), 필터는 숫자범위. N0대보다 먼저 체크
        # (안 그러면 '2030 대화'의 '30대'로 오인). 제목·설명 둘 다.
        for text in (title or '', description or ''):
            if re.search(r'20\s*30(?!\d)', text):
                return (20, 39, '2030')
            if re.search(r'30\s*40(?!\d)', text):
                return (30, 49, '3040')
            if re.search(r'20\s*40(?!\d)', text):
                return (20, 49, '2040')
        # 'N0대' — 앞에 숫자 없고 대 바로 뒤(공백 없이) = 진짜 나이대('2030 대화' 오매칭 방지)
        m = re.search(r'(?<!\d)(\d0)대', title or '')
        if m:
            base = int(m.group(1))
            return (max(18, base), min(60, base + 9), f'{base}대')
        return (None, None, None)

    def _parse_gender_items(self, select_items: list[dict]) -> tuple:
        """
        selectItems에서 남/여 가격·잔여석·정원 분리 파싱
        반환: (price_male, price_female, seats_left_male, seats_left_female, capacity_male, capacity_female)
        """
        price_male: Optional[int] = None
        price_female: Optional[int] = None
        seats_left_male: Optional[int] = None
        seats_left_female: Optional[int] = None
        capacity_male: Optional[int] = None
        capacity_female: Optional[int] = None

        # 안내/공지용 아이템 키워드
        skip_kws = ['공지용', '선택 X', '안내용', '정보 확인', '선택X']

        for item in select_items:
            name: str = item.get('name', '') or ''
            remains = item.get('remains')
            quota = item.get('quota')

            item_data = item.get('item') or {}
            price_obj = item_data.get('price') or {}
            sale = price_obj.get('sale')
            sale_price: Optional[int] = None
            if sale:
                try:
                    sale_price = int(float(str(sale)))
                except (ValueError, TypeError):
                    pass

            # 공지/안내 아이템 제외
            if any(k in name for k in skip_kws):
                continue

            # 성별 판별
            is_male = bool(
                re.search(r'남성|남자', name)
                or re.search(r'남\s*(참|권|티|｜|\||\()', name)
                or name.strip() in ('남', '남성', '남자')
            )
            is_female = bool(
                re.search(r'여성|여자', name)
                or re.search(r'여\s*(참|권|티|｜|\||\()', name)
                or name.strip() in ('여', '여성', '여자')
            )

            # 이모지가 붙은 경우 처리 (예: "🙆‍♂️남성 참여권", "🙋‍♀️여성 참여권")
            if not is_male and not is_female:
                if re.search(r'남', name):
                    is_male = True
                elif re.search(r'여', name):
                    is_female = True

            if is_male:
                if sale_price is not None and price_male is None:
                    price_male = sale_price
                if remains is not None and seats_left_male is None:
                    seats_left_male = remains
                if quota is not None and capacity_male is None:
                    capacity_male = quota
            elif is_female:
                if sale_price is not None and price_female is None:
                    price_female = sale_price
                if remains is not None and seats_left_female is None:
                    seats_left_female = remains
                if quota is not None and capacity_female is None:
                    capacity_female = quota

        return price_male, price_female, seats_left_male, seats_left_female, capacity_male, capacity_female

    def _parse_age_info(
        self,
        select_items: list[dict],
        description_text: str,
        recommended_age: Optional[int],
    ) -> tuple:
        """
        나이 범위 정보 파싱
        반환: (age_range_min, age_range_max, age_group_label)
        """
        # 1) selectItems 이름에서 "XX~YY년생" 패턴
        names_combined = ' '.join(item.get('name', '') for item in select_items)
        m = AGE_RANGE_RE.search(names_combined)
        if not m:
            m = AGE_RANGE_RE.search(description_text)

        if m:
            y1_short, y2_short = int(m.group(1)), int(m.group(2))
            current_year = datetime.now().year
            y1 = (1900 + y1_short) if y1_short >= 50 else (2000 + y1_short)
            y2 = (1900 + y2_short) if y2_short >= 50 else (2000 + y2_short)
            age_min = current_year - max(y1, y2)
            age_max = current_year - min(y1, y2)
            # DB constraint: age_range_min >= 18, age_range_max <= 60
            age_min = max(18, age_min) if age_min is not None else None
            age_max = min(60, age_max) if age_max is not None else None
            if age_min is not None and age_max is not None and age_min > age_max:
                return None, None, None
            age_group = f"{m.group(1)}~{m.group(2)}년생"
            return age_min, age_max, age_group

        # 2) description 또는 이름에서 "X0대" 패턴
        decade_matches = AGE_DECADE_RE.findall(names_combined + ' ' + description_text)
        if decade_matches:
            decades = sorted(set(int(d) for d in decade_matches))
            age_min = decades[0]
            age_max = decades[-1] + 9
            # DB constraint: age_range_min >= 18, age_range_max <= 60
            age_min = max(18, age_min)
            age_max = min(60, age_max)
            if age_min > age_max:
                return None, None, None
            return age_min, age_max, None

        # 3) frip.recommendedAge 사용
        if recommended_age and recommended_age > 0:
            # DB constraint 검증
            if recommended_age < 18 or recommended_age > 60:
                return None, None, None
            return recommended_age, None, None

        return None, None, None

    def _parse_participant_stats(self, description_text: str) -> Optional[dict]:
        """
        description 텍스트에서 참가자 현황 파싱

        지원 패턴:
        - "남자 N번: Xcm / 직업"
        - "여자 N번: Xcm / 직업"
        - "남: 직업1, 직업2, ..."
        - "여: 직업1, 직업2, ..."
        """
        result: dict = {"male": [], "female": []}
        skip_words = ['정보 확인', '접수 대기', '확인 중', '대기 중', '모집 중', '미정', '선정 중', '비공개']

        # 패턴 1: "남자 N번: Xcm / 직업" 또는 "남자 N번: 직업"
        male_re = re.compile(
            r'남자\s*\d+번\s*[:：]\s*(?:(\d+)cm)?\s*(?:/\s*)?([^\n]+?)(?:\s*[-\n]|$)',
            re.MULTILINE,
        )
        female_re = re.compile(
            r'여자\s*\d+번\s*[:：]\s*(?:(\d+)cm)?\s*(?:/\s*)?([^\n]+?)(?:\s*[-\n]|$)',
            re.MULTILINE,
        )

        for regex, key in [(male_re, 'male'), (female_re, 'female')]:
            for match in regex.finditer(description_text):
                height_str = match.group(1)
                job_str = (match.group(2) or '').strip()
                # 불필요한 접미어 제거
                job_str = re.sub(r'\s*[-\–\—].*$', '', job_str).strip()
                if any(w in job_str for w in skip_words):
                    continue
                if not job_str and not height_str:
                    continue
                entry: dict = {}
                if height_str:
                    try:
                        entry['height'] = int(height_str)
                    except (ValueError, TypeError):
                        pass
                if job_str:
                    entry['job'] = job_str
                if entry:
                    result[key].append(entry)

        if result['male'] or result['female']:
            return result

        # 패턴 2: "남: 직업1, 직업2, ..." / "여: 직업1, 직업2, ..."
        male_jobs_m = re.search(r'남\s*[:：]\s*([^\n]+)', description_text)
        female_jobs_m = re.search(r'여\s*[:：]\s*([^\n]+)', description_text)

        if male_jobs_m:
            raw = male_jobs_m.group(1)
            jobs = [j.strip() for j in re.split(r'[,，、]', raw) if j.strip()]
            result['male'] = [
                {'job': j} for j in jobs
                if j and '등' not in j and len(j) < 20
            ]
        if female_jobs_m:
            raw = female_jobs_m.group(1)
            jobs = [j.strip() for j in re.split(r'[,，、]', raw) if j.strip()]
            result['female'] = [
                {'job': j} for j in jobs
                if j and '등' not in j and len(j) < 20
            ]

        if result['male'] or result['female']:
            return result
        return None

    def _parse_age_group_label_from_items(self, select_items: list[dict]) -> Optional[str]:
        """selectItems 이름에서 나이대 라벨 추출 (구형 호환)"""
        for item in select_items:
            name = item.get('name', '')
            m = AGE_RANGE_RE.search(name)
            if m:
                return f"{m.group(1)}~{m.group(2)}년생"
        return None

    # ─── 메인 변환 (상품 → 일정별 이벤트 목록) ─────────────────────────────────

    def _product_to_events(self, node: dict, client: httpx.Client) -> list[EventModel]:
        """상품 하나의 모든 일정을 이벤트로. 상품정보(제목·설명·지역·썸네일)는 1회,
        일정별 selectItems로 나이/성별가격/잔여석을 뽑아 각각 이벤트 생성."""
        try:
            title = node.get('title') or ''
            if not any(kw in title for kw in ['소개팅', '미팅', '로테이션', '파티', '번개', '썸', '솔로']):
                return []
            product_id = str(node.get('id'))
            area = node.get('areaName') or ''

            # ── 상품 상세(설명·recommendedAge) 1회 ──
            detail = self._fetch_detail(product_id, client)
            description_text = ''
            recommended_age: Optional[int] = None
            if detail:
                contents = detail.get('contents') or []
                html_parts = [c.get('content', '') for c in contents if c.get('content')]
                full_html = ' '.join(html_parts)
                if full_html:
                    description_text = self._html_to_text(full_html)
                rec_age = (detail.get('frip') or {}).get('recommendedAge')
                if rec_age and int(rec_age) > 0:
                    recommended_age = int(rec_age)

            region = resolve_region(region_phrase=area or None, title=title,
                                    body=description_text or None)
            thumbnails: list[str] = []
            for hc in node.get('headerContents') or []:
                thumb = (hc.get('content') or {}).get('thumbnail')
                if thumb:
                    thumbnails.append(thumb)
                    break
            theme = ['일반']
            if '와인' in title:
                theme = ['와인']
            elif '쿠킹' in title or '요리' in title:
                theme = ['쿠킹']
            desc_clean = sanitize_text(description_text, 6000) if description_text else None
            title_clean = sanitize_text(f'[프립] {title}', 80)

            # ── 전체 일정 조회 → 일정별 이벤트 ──
            KST = timezone(timedelta(hours=9))
            now_utc = datetime.now(timezone.utc)
            horizon = now_utc + timedelta(days=62)
            schedules = self._fetch_schedules_multi(product_id, client)
            events: list[EventModel] = []
            for sc in schedules:
                event_date = datetime.fromtimestamp(sc['startedAt'] / 1000, tz=timezone.utc)
                if event_date < now_utc or event_date > horizon:
                    continue
                sid = sc['id']
                select_items = self._fetch_select_items(product_id, sid, client)
                kst = event_date.astimezone(KST)
                anchor = kst.strftime("%Y%m%d%H%M")

                # 한 일정에 지점이 여러 개면(예: 사당+수원 각각 가격) 지점별로 분리 → 각각 이벤트.
                # 지점 1개(또는 0개)면 분리 안 함(전체 옵션 사용) — 가격옵션에 지점 키워드가
                # 없어도 누락 안 되게. 2개 이상일 때만 지점 키워드로 옵션을 나눈다.
                venues = list(dict.fromkeys(
                    kw for kw in VENUE_KW if any(kw in (it.get('name') or '') for it in select_items)))
                multi = len(venues) >= 2
                if multi:
                    groups = [(v, [it for it in select_items if v in (it.get('name') or '')]) for v in venues]
                else:
                    groups = [(venues[0] if venues else None, select_items)]

                for v, v_items in groups:
                    pm, pf, sm, sf, cm, cf = self._parse_gender_items(v_items)
                    if pm is None and pf is None:
                        continue  # 이 지점에 판매 옵션 없음
                    amin, amax, disp = self._parse_age_smart(v_items, title, description_text,
                                                             recommended_age)
                    # disp 있으면 '2030' 등 그대로 표시, 없으면 admin/앱이 'min~max세'로
                    age_label = disp
                    sched_region = resolve_region(region_phrase=v, title=title, body=None) if v else region
                    if sc.get('remains') == 0:
                        if sm is None:
                            sm = 0
                        if sf is None:
                            sf = 0
                    su = f'{FRIP_BASE}/products/{product_id}#evt={anchor}'
                    if multi and v:
                        su += f'-{v}'  # 같은 일정 다지점 → source_url 유니크
                    events.append(EventModel(
                        title=title_clean, description=desc_clean,
                        event_date=event_date, location_region=sched_region, location_detail=area or None,
                        price_male=pm, price_female=pf, gender_ratio=None,
                        source_url=su, thumbnail_urls=thumbnails, theme=theme,
                        seats_left_male=sm, seats_left_female=sf,
                        capacity_male=cm, capacity_female=cf,
                        age_range_min=amin, age_range_max=amax, age_group_label=age_label,
                    ))
            return events
        except Exception as e:
            self.logger.warning(f'프립 상품 파싱 실패 {node.get("id")}: {e}')
            return []

    def _node_to_event_OLD(self, node: dict, client: httpx.Client) -> Optional[EventModel]:
        try:
            ts = node.get('scheduleFirstDate')
            if not ts:
                return None

            event_date = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc)
            if event_date < datetime.now(timezone.utc):
                return None

            title = node.get('title') or ''
            if not any(kw in title for kw in ['소개팅', '미팅', '로테이션', '파티', '번개', '썸', '솔로']):
                return None

            area = node.get('areaName') or ''

            product_id = str(node.get('id'))

            # ── 1) 스케줄 조회 ──
            schedule = self._fetch_schedule(product_id, client)
            schedule_id = schedule.get('id') if schedule else None

            # ── 2) selectItems 조회 ──
            select_items = self._fetch_select_items(product_id, schedule_id, client)

            # ── 3) 성별 가격·잔여석·정원 파싱 ──
            price_male, price_female, seats_left_male, seats_left_female, capacity_male, capacity_female = \
                self._parse_gender_items(select_items)

            # fallback: salePrice 사용
            if price_male is None and price_female is None:
                sale_price = node.get('salePrice')
                if sale_price:
                    try:
                        price_val = int(float(str(sale_price)))
                        price_male = price_val
                        price_female = price_val
                    except (ValueError, TypeError):
                        pass

            # ── 4) 상품 상세 조회 (description + recommendedAge) ──
            detail = self._fetch_detail(product_id, client)
            description_text = ''
            recommended_age: Optional[int] = None
            if detail:
                # contents HTML → plain text
                contents = detail.get('contents') or []
                html_parts = [c.get('content', '') for c in contents if c.get('content')]
                full_html = ' '.join(html_parts)
                if full_html:
                    description_text = self._html_to_text(full_html)

                frip_info = detail.get('frip') or {}
                rec_age = frip_info.get('recommendedAge')
                if rec_age and int(rec_age) > 0:
                    recommended_age = int(rec_age)

            # ── 지역 결정 (areaName 우선, 조합지역 "동대문·성북" 등 유지) ──
            region = resolve_region(
                region_phrase=area or None,
                title=title,
                body=description_text or None,
            )

            # ── 5) 나이대 파싱 ──
            age_range_min, age_range_max, age_group_label = self._parse_age_info(
                select_items, description_text, recommended_age
            )

            # ── 6) participant_stats 파싱 ──
            participant_stats: Optional[dict] = None
            if description_text:
                participant_stats = self._parse_participant_stats(description_text)
                # selectItems 기반 seats 정보 병합
                if participant_stats is not None:
                    if seats_left_male is not None:
                        participant_stats['seats_left_male'] = seats_left_male
                    if seats_left_female is not None:
                        participant_stats['seats_left_female'] = seats_left_female

            # ── 7) 썸네일 ──
            thumbnails: list[str] = []
            for hc in node.get('headerContents') or []:
                thumb = (hc.get('content') or {}).get('thumbnail')
                if thumb:
                    thumbnails.append(thumb)
                    break

            # ── 8) 테마 ──
            theme = ['일반']
            if '와인' in title:
                theme = ['와인']
            elif '쿠킹' in title or '요리' in title:
                theme = ['쿠킹']

            source_url = f'{FRIP_BASE}/products/{product_id}'

            return EventModel(
                title=sanitize_text(f'[프립] {title}', 80),
                description=sanitize_text(description_text, 6000) if description_text else None,
                event_date=event_date,
                location_region=region,
                location_detail=area or None,
                price_male=price_male,
                price_female=price_female,
                gender_ratio=None,
                source_url=source_url,
                thumbnail_urls=thumbnails,
                theme=theme,
                seats_left_male=seats_left_male,
                seats_left_female=seats_left_female,
                capacity_male=capacity_male,
                capacity_female=capacity_female,
                age_range_min=age_range_min,
                age_range_max=age_range_max,
                age_group_label=age_group_label,
                participant_stats=participant_stats,
            )
        except Exception as e:
            self.logger.warning(f'프립 노드 파싱 실패: {e}')
            return None
