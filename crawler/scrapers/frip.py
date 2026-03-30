"""프립 (frip.co.kr) 스크래퍼 — GraphQL API 기반 (상세 데이터 수집)

수집 전략:
1. ListingProductV4 API로 소개팅 카테고리 상품 목록 수집
2. 각 상품에 대해 GetFirstPurchasableSchedule + GetSelectItems 호출 → 남/여 잔여석·가격·정원
3. GetProductDetailPageData 호출 → description(contents) + frip.recommendedAge
4. description HTML 파싱 → participant_stats, age_group_label, age_range_min/max
"""

import re
import html as html_module
from datetime import datetime, timezone
from typing import Optional

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month

FRIP_GQL = 'https://gql.frip.co.kr/graphql'
FRIP_BASE = 'https://frip.co.kr'

# 소셜/소개팅모임 카테고리 ID
CATEGORY_IDS = [2841]

PRICE_RE = re.compile(r'[\d.]+')
REGION_KW = ['강남', '서초', '홍대', '신촌', '잠실', '건대', '성수', '이태원', '합정', '여의도',
             '마포', '종로', '용산', '동작', '관악', '수원', '인천', '부산', '대구', '대전']

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
                    ev = self._node_to_event(node, client)
                    if ev:
                        events.append(ev)
        except Exception as e:
            self.logger.error(f'프립 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
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

    # ─── 메인 변환 ──────────────────────────────────────────────────────────────

    def _node_to_event(self, node: dict, client: httpx.Client) -> Optional[EventModel]:
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
            region = '서울'
            for kw in REGION_KW:
                if kw in area or kw in title:
                    region = kw
                    break

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
