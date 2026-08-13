"""연인어때 (yeonin.co.kr) 스크래퍼"""
import re
import time
import asyncio
import json
import httpx
from html import unescape
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url
from utils.date_filter import is_within_one_month
from utils.region import resolve_region


# ─────────────────────────────────────────────
# 나이 변환 유틸 (만나이)
# ⚠️ 출생연도 → 나이는 만나이로 계산한다(+1 금지).
#    업체 사이트가 만나이로 적어놓기 때문이다 — 에모셔널오렌지 '남: 만 23-28세(03-98년생)',
#    괜찮소 '38세~45세 [만나이 적용!!]', 시크릿살롱 '(만26-35세)'. 한국나이로 적는 업체는
#    한 곳도 없다(2026-07-28 10개 업체 사이트 전수 확인).
#    +1 하면 사이트보다 1살 많게 나가 사용자가 신청 가능한 모임을 놓치거나(로꼬: 사이트는
#    04년생=만22세까지인데 앱엔 23세부터), 안 되는 줄 알고 갔다가 거절당한다
#    (연인어때: 앱엔 35세까지인데 사이트는 92년생=만34세까지).
# 예: 95년생 → 31세, 02년생 → 24세
# ─────────────────────────────────────────────
BASE_YEAR = 2026


def _year2age(year_2digit_or_4digit: str) -> int:
    """'95', '02', '1995', '2002' 형태의 년생 문자열 → 만나이(int)"""
    y = int(year_2digit_or_4digit)
    if y < 100:
        # 2자리 년생: 00~30 → 2000년대, 31~99 → 1900년대
        y = (2000 + y) if y <= 30 else (1900 + y)
    return BASE_YEAR - y


def _parse_age_range_from_label(age_group_label: str) -> tuple[Optional[int], Optional[int]]:
    """
    'A그룹(95~02년생)' 또는 '남: 95-02년생' 형태에서
    age_range_min(작은 나이), age_range_max(큰 나이) 추출.

    출생년도가 클수록(최근) 나이는 어리므로:
      min_year(큰 숫자, 예:02) → 작은 나이 → age_range_min
      max_year(작은 숫자, 예:95) → 큰 나이  → age_range_max
    """
    m = re.search(r'(\d{2,4})\s*[-~]\s*(\d{2,4})년생', age_group_label)
    if not m:
        return None, None
    yr1, yr2 = m.group(1), m.group(2)
    age1, age2 = _year2age(yr1), _year2age(yr2)
    return min(age1, age2), max(age1, age2)


class YeoninScraper(BaseScraper):
    # 상품 옵션(load_option.cm)에서 성별 가격·품절을 그대로 읽으므로 가격 정본이다.
    # 옛 게시판 본문 파싱 시절엔 가격이 부정확해 꺼져 있었고, 그 탓에 새로 들어온
    # 이벤트가 전부 가격 없이 저장됐다(2026-07-28 확인 — base_scraper 가 저장 직전에 버림).
    WRITES_PRICE = True

    # 사이트에서 내려간 회차를 자동 정리한다. 전체 일정을 예약위젯 옵션에서
    # 안정적으로 뽑으므로 켜도 안전하다(부분 실패는 base_scraper 가 50% 룰로 막는다).
    # 껐을 땐 지난 회차·시각이 바뀐 중복이 계속 쌓여 같은 모임이 두 번 보였다
    # (2026-07-28: 연인어때 15건·로꼬 25건을 손으로 지움).
    DELETE_STALE = True
    # 성별 나이도 옵션 라벨(남: 95-02)에서 나온다 → 정본. None 이면 옛 값을 지운다.
    WRITES_AGE = True

    BASE_URL = 'https://yeonin.co.kr'
    SCHEDULE_URL = 'https://yeonin.co.kr/schedule'
    LIST_URL = 'https://yeonin.co.kr/list'

    def __init__(self):
        super().__init__('yeonin')

    # ── 상품 옵션(지역→성별→일시) 파싱용 ────────────────────────────────
    # imweb 상품의 옵션은 load_option.cm 이 단계별로 내려준다.
    # 1단계: 지역 / 2단계: 성별 / 3단계: 일시(라벨에 날짜·시간·남성 출생연도, 가격·품절 포함)
    _OPT_RE = re.compile(
        r"selectRequireOption\('prod',\s*\d+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'")
    _SLOT_DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})')
    _SLOT_TIME_RE = re.compile(r'(오전|오후)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?')
    _SLOT_AGE_RE = re.compile(r'남[:\s]*(\d{2})[-~](\d{2})')

    def _load_option(self, idx: str, extra: str = '') -> str:
        """상품 옵션 HTML 조회(load_option.cm). 단계별 선택값을 extra 로 넘긴다."""
        try:
            r = httpx.post(
                f'{self.BASE_URL}/shop/load_option.cm',
                headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': f'{self.BASE_URL}/shop_view/?idx={idx}',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                content=f'type=prod&prod_idx={idx}{extra}&__=1',
                timeout=20, verify=False, follow_redirects=True)
            body = r.text
            try:
                body = json.loads(body).get('option_html', body)
            except Exception:
                pass
            return unescape(body)
        except Exception as e:
            self.logger.warning(f'옵션 조회 실패 (idx={idx}): {e}')
            return ''

    def _fetch_thumbnail(self, idx: str) -> Optional[str]:
        """상품 상세페이지(shop_view)의 og:image — 지역 상품(idx)의 대표 사진.
        같은 idx 밑의 모든 날짜·시간 회차가 이 한 장을 공유한다(연인어때는 실제
        사이트도 지역 상품 하나에 사진 한 장을 쓴다). 예전엔 옵션 API(load_option.cm)
        로만 날짜·가격·나이를 뽑고 사진은 아예 시도하지 않아 피드·상세가 계속
        비어 있었다(오너가 실제 사이트엔 사진이 있는 걸 보고 발견, 2026-08-13)."""
        try:
            r = httpx.get(
                f'{self.BASE_URL}/shop_view',
                params={'idx': idx},
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'},
                timeout=15, verify=False, follow_redirects=True)
            og = BeautifulSoup(r.text, 'html.parser').find('meta', property='og:image')
            return og['content'] if og and og.get('content') else None
        except Exception as e:
            self.logger.debug(f'썸네일 조회 실패 (idx={idx}): {e}')
            return None

    @staticmethod
    def _sel_param(pairs) -> str:
        return ''.join(
            f'&selected_require_options%5B{i}%5D%5Bvalue_type%5D=SELECT'
            f'&selected_require_options%5B{i}%5D%5Boption_code%5D={gh}'
            f'&selected_require_options%5B{i}%5D%5Bvalue_code%5D={vh}'
            for i, (gh, vh) in enumerate(pairs))

    def _parse_slots(self, html: str) -> dict:
        """3단계(일시) 옵션 → {datetime: {price, soldout, age}}"""
        out = {}
        for item in re.findall(r'<div class="dropdown-item.*?</a>', html, re.S):
            lb = re.search(r'margin-bottom-lg">([^<]+)<', item)
            pr = re.search(r'<strong>\s*₩?\s*([\d,]+)', item)
            if not lb or not pr:
                continue
            label = lb.group(1)
            dm = self._SLOT_DATE_RE.search(label)
            tm = self._SLOT_TIME_RE.search(label)
            if not dm or not tm:
                continue
            mo, da = int(dm.group(1)), int(dm.group(2))
            period, hh, mm = tm.group(1), int(tm.group(2)), int(tm.group(3) or 0)
            if period == '오후' and hh < 12:
                hh += 12
            elif not period and 1 <= hh <= 9:
                hh += 12  # "4시30분" 처럼 오전/오후 없는 표기는 오후로 본다
            now = datetime.now()
            year = now.year + 1 if mo < now.month else now.year
            try:
                dt = datetime(year, mo, da, hh, mm)
            except ValueError:
                continue
            am = self._SLOT_AGE_RE.search(label)
            age = (_year2age(am.group(2)), _year2age(am.group(1))) if am else None
            out[dt] = {
                'price': int(pr.group(1).replace(',', '')),
                'soldout': '품절' in item,
                'age': age,
            }
        return out

    def scrape(self) -> list[EventModel]:
        """월 일정 게시글에 걸린 '지역 상품'들을 돌며 (지역×일시) 슬롯마다 1이벤트 생성.

        ⚠️ 예전엔 월 일정 게시글의 '본문 텍스트'를 줄 단위로 훑어 날짜 패턴이 걸릴 때마다
           이벤트를 만들었다. 표를 텍스트로 펼치면 줄이 어긋나 제목이 뒤죽박죽이 되고
           ('로테이션 소개팅 A 8.8(토) 오후 4시 로테이션 소개팅 B ...'), '고객 만족도
           4.94점' 같은 줄까지 날짜로 걸려(한 게시글에서 101줄) 신청도 못 하는 이벤트가
           양산됐다. 링크도 게시글 하나를 공유해 실제 신청 페이지로 가지 못했다.
           (2026-07-24 이후 생성분에서 오너가 발견 — 2026-07-28 교체)

           지금은 상품 옵션 API(load_option.cm)를 쓴다. 날짜·시간·남성 연령·가격·품절이
           옵션 라벨에 그대로 들어 있어 추측할 필요가 없고, 링크도 상품별 신청 페이지다.
        """
        events: list[EventModel] = []
        products: dict[str, str] = {}   # idx → 지역
        names: dict[str, str] = {}      # idx → 상품명(이벤트 제목)

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True, locale='ko-KR',
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
                page = context.new_page()

                # 최신 월 일정 게시글 → 거기 걸린 지역 상품 링크 수집
                page.goto(self.SCHEDULE_URL, timeout=30000, wait_until='domcontentloaded')
                page.wait_for_timeout(2500)
                links = page.eval_on_selector_all(
                    'a[href*="idx="]', 'els=>els.map(e=>({h:e.href,t:e.innerText.trim()}))')
                summary = next((x for x in links if '로테이션 소개팅 일정' in x['t']), None)
                if not summary:
                    self.logger.warning('월 일정 게시글을 찾지 못함')
                    browser.close()
                    return []

                url = summary['h'] if 'bmode' in summary['h'] else summary['h'] + '&bmode=view'
                page.goto(url, timeout=30000, wait_until='domcontentloaded')
                page.wait_for_timeout(3000)
                for it in page.eval_on_selector_all(
                        'a[href*="shop_view"]', 'els=>els.map(e=>({h:e.href,t:e.innerText.trim()}))'):
                    m = re.search(r'idx=(\d+)', it['h'])
                    reg = re.search(r'\[([^\]]+)\]', it['t'] or '')
                    if m and reg and m.group(1) not in products:
                        products[m.group(1)] = reg.group(1).strip()
                        names[m.group(1)] = (it['t'] or '').split('\n')[0].strip() or reg.group(1).strip()

                browser.close()
        except Exception as e:
            self.logger.error(f'상품 목록 수집 실패: {e}')
            raise

        if not products:
            # 상품을 못 찾았는데 빈 배열을 돌려주면 base_scraper 가 기존 이벤트를
            # stale 로 보고 지울 수 있다. 예외로 올려 크롤 실패로 남긴다.
            raise RuntimeError('연인어때 지역 상품 0개 — 사이트 구조 변경 의심')
        self.logger.info(f'지역 상품 {len(products)}개 발견')

        for idx, region in products.items():
            try:
                base = self._load_option(idx)
                regions = self._OPT_RE.findall(base)
                if not regions:
                    self.logger.warning(f'[{region}] 1단계(지역) 옵션 없음 — 스킵')
                    continue
                r0 = regions[0]
                step2 = self._load_option(idx, self._sel_param([(r0[0], r0[1])]))
                gmap = {o[2]: (o[0], o[1]) for o in self._OPT_RE.findall(step2)
                        if o[2] in ('남성', '여성')}
                male = self._parse_slots(self._load_option(
                    idx, self._sel_param([(r0[0], r0[1]), gmap['남성']]))) if '남성' in gmap else {}
                female = self._parse_slots(self._load_option(
                    idx, self._sel_param([(r0[0], r0[1]), gmap['여성']]))) if '여성' in gmap else {}

                # 지역 상품(idx) 하나당 한 번만 조회 — 그 밑 모든 회차가 같은 사진을 쓴다.
                thumb = self._fetch_thumbnail(idx)

                for dt in sorted(set(male) | set(female)):
                    m, f = male.get(dt), female.get(dt)
                    age = (m or f).get('age')
                    detail = {}
                    if m:
                        detail['male'] = {'regular': m['price'],
                                          **({'regular_soldout': True} if m['soldout'] else {})}
                    if f:
                        detail['female'] = {'regular': f['price'],
                                            **({'regular_soldout': True} if f['soldout'] else {})}
                    events.append(EventModel(
                        title=sanitize_text(names.get(idx) or region, 80),
                        description=None,
                        event_date=dt,
                        location_region=resolve_region(region_phrase=region, title=names.get(idx, ''), body=''),
                        location_detail=None,
                        price_male=m['price'] if m else None,
                        price_female=f['price'] if f else None,
                        gender_ratio=None,
                        source_url=f'{self.BASE_URL}/shop_view?idx={idx}#evt={dt.strftime("%Y%m%d%H%M")}',
                        thumbnail_urls=[thumb] if thumb else [],
                        theme=['일반'],
                        age_group_label=f'{age[0]}~{age[1]}세' if age else None,
                        # 앱 카드·상세가 실제로 보여주는 건 age_male/age_female 이다.
                        # 연인어때는 옵션 라벨에 남성 연령만 있고 여성은 '제한 ❌'.
                        age_male=f'{age[0]}~{age[1]}' if age else None,
                        age_female='나이 무관',
                        age_range_min=age[0] if age else None,
                        age_range_max=age[1] if age else None,
                        price_detail=detail or None,
                        is_closed=bool(m and m['soldout'] and f and f['soldout']),
                    ))
                time.sleep(0.4)
            except Exception as e:
                self.logger.warning(f'[{region}] 상품 파싱 실패(idx={idx}): {e}')

        filtered = [ev for ev in events if is_within_one_month(ev.event_date)]
        self.logger.info(f'연인어때 총 {len(filtered)}개 이벤트 (필터 전: {len(events)}개)')
        return filtered

    def _extract_description(self, soup: BeautifulSoup, og_desc_meta) -> Optional[str]:
        """상세 페이지 본문 텍스트 추출 (해시태그 키워드 확보용).

        imweb 게시글 본문 영역을 우선 시도하고, 없으면 og:description 메타를 사용.
        네비/푸터 보일러플레이트는 본문 영역 선택자로 배제한다.
        """
        # 1) 본문 영역 후보 선택자 (imweb 게시판/에디터 공통)
        content_selectors = [
            '.post_content', '.board_view', '.se-viewer', '.se-main-container',
            '.content_area', '.post_area', 'article', '#content',
        ]
        best_text = ''
        for sel in content_selectors:
            for node in soup.select(sel):
                text = node.get_text(separator=' ', strip=True)
                if len(text) > len(best_text):
                    best_text = text

        # 2) 본문 영역이 빈약하면 og:description 사용
        if len(best_text) < 30 and og_desc_meta:
            best_text = og_desc_meta.get('content', '') or ''

        return sanitize_text(best_text, 800) if best_text else None

    def _parse_age_groups_from_og(self, og_description: str) -> list[str]:
        """
        og:description 에서 그룹별 나이대 추출.

        실제 포맷 예시:
          "로테이션 소개팅 A남: 95-02년생여: 제한 없음 ❌남: 키 172 이상여: 키 150 이상
           로테이션 소개팅 B남: 92-99년생여: 제한 없음 ❌..."

        반환: ['A그룹(95~02년생)', 'B그룹(92~99년생)', ...]
        """
        age_groups = []
        # "로테이션 소개팅 X남: YY-ZZ년생" 패턴
        pattern = re.compile(
            r'로테이션\s*소개팅\s*([A-D])(?:\s*\([^)]*\))?\s*남\s*:\s*(\d{2,4})\s*[-~]\s*(\d{2,4})년생'
        )
        for m in pattern.finditer(og_description):
            group_letter = m.group(1)
            yr1, yr2 = m.group(2), m.group(3)
            # 두 자리 년도를 4자리로 정규화
            y1_norm = (2000 + int(yr1)) if int(yr1) <= 30 else (1900 + int(yr1))
            y2_norm = (2000 + int(yr2)) if int(yr2) <= 30 else (1900 + int(yr2))
            # 표시는 2자리로 (원문 그대로)
            age_groups.append(f'{group_letter}그룹({yr1}~{yr2}년생)')
        return age_groups

    def _parse_age_groups_from_table(self, soup: BeautifulSoup) -> list[str]:
        """게시물 첫 번째 <table>에서 그룹 A/B/C/D 연령대 추출

        실제 테이블 구조:
          td[0]: "로테이션 소개팅 A"
          td[1]: "남: 95-02년생 여: 제한 없음"
        셀이 분리되어 있으므로 td 단위로 직접 접근하여 파싱한다.
        """
        age_groups = []
        tables = soup.select('table')
        if not tables:
            return age_groups

        first_table = tables[0]
        rows = first_table.find_all('tr')
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
            if not cells:
                continue

            # 첫 번째 셀에서 그룹 레이블 추출 (A, B, C, D 또는 A그룹 등)
            group_label = None
            label_m = re.search(r'([A-D])\s*그룹', cells[0])
            if label_m:
                group_label = label_m.group(1) + '그룹'
            else:
                # "로테이션 소개팅 A" 형태에서 끝에 오는 알파벳 추출
                label_m2 = re.search(r'\b([A-D])\b', cells[0])
                if label_m2:
                    group_label = label_m2.group(1) + '그룹'

            if not group_label:
                # 그룹 라벨이 없으면 row_text 전체에서 fallback 패턴 시도
                row_text = ' '.join(cells)
                m = re.search(r'([A-D]그룹[^\)]*\))', row_text)
                if m:
                    age_groups.append(m.group(1))
                    continue
                m2 = re.search(r'([A-D])\s*[:\-]\s*(\d{2,4}[-~]\d{2,4}년생)', row_text)
                if m2:
                    age_groups.append(f'{m2.group(1)}그룹({m2.group(2)})')
                continue

            # 나머지 셀에서 년생 범위 패턴 추출
            age_range = None
            for cell_text in cells[1:]:
                age_m = re.search(r'(\d{2,4}[-~]\d{2,4}년생)', cell_text)
                if age_m:
                    age_range = age_m.group(1)
                    break

            if age_range:
                age_groups.append(f'{group_label}({age_range})')
            else:
                # 나이 범위 없이 그룹 레이블만 있는 경우도 추가
                age_groups.append(group_label)

        return age_groups

    def _parse_participant_from_og(self, og_title: str, og_description: str) -> Optional[tuple[str, dict]]:
        """
        /list 게시글의 og:title + og:description 에서 참가자 명단 파싱.

        og:title 예: "3/29(일) 오후 5시30분(나이B) : 참가자 명단 | ..."
        og:description 예:
          "...남성 참가자♥1호 - 90중반/자영업/176/다정 ♥2호 - ...
           여성 참가자♥1호 - 90후반/서비스직/163/... ♥ 모집 마감 ♥"

        반환: (date_key, {'male': [...], 'female': [...], 'group': 'B', 'seats_left_male': int, 'seats_left_female': int})
        """
        # 날짜 키 추출 (예: "3/29")
        date_m = re.search(r'(\d{1,2})/(\d{1,2})', og_title)
        if not date_m:
            return None
        date_key = f"{date_m.group(1)}/{date_m.group(2)}"

        # 그룹 레이블 추출 (나이B → B)
        group_m = re.search(r'나이([A-D])', og_title)
        group_letter = group_m.group(1) if group_m else None

        # 남성/여성 참가자 섹션 분리
        male_section = ''
        female_section = ''

        male_split = re.split(r'남성\s*참가자', og_description)
        if len(male_split) > 1:
            rest = male_split[1]
            female_split = re.split(r'여성\s*참가자', rest)
            male_section = female_split[0]
            if len(female_split) > 1:
                female_section = female_split[1]

        def parse_section(section_text: str) -> tuple[list[dict], int]:
            """참가자 섹션 텍스트에서 참가자 목록과 잔여석 수 반환"""
            participants = []
            seats_left = 0

            # "♥N호 - 정보/직업/키/키워드" 패턴
            entries = re.findall(r'♥\d+호\s*-\s*([^♥]+)', section_text)
            for entry in entries:
                entry = entry.strip()
                if '신청 가능' in entry:
                    seats_left += 1
                    continue
                if '정보 확인 중' in entry or '모집' in entry:
                    continue

                parts = [p.strip() for p in entry.split('/')]
                info: dict = {}

                # 연대 정보 (첫 번째 파트: "90중반", "00초반" 등)
                if parts:
                    gen_m = re.search(r'(\d{2}(?:초반|중반|후반))', parts[0])
                    if gen_m:
                        info['generation'] = gen_m.group(1)

                # 직업 (두 번째 파트)
                if len(parts) > 1:
                    info['job'] = parts[1]

                # 키 (세 번째 파트: 숫자)
                if len(parts) > 2:
                    height_m = re.search(r'(1[5-9]\d)', parts[2])
                    if height_m:
                        info['height'] = int(height_m.group(1))

                # 매력 포인트 (네 번째 파트)
                if len(parts) > 3:
                    info['trait'] = parts[3]

                if info:
                    participants.append(info)

            return participants, seats_left

        male_list, seats_left_male = parse_section(male_section)
        female_list, seats_left_female = parse_section(female_section)

        if not male_list and not female_list:
            return None

        result = {
            'male': male_list,
            'female': female_list,
            'group': group_letter,
            'seats_left_male': seats_left_male,
            'seats_left_female': seats_left_female,
            'male_count': len(male_list),
            'female_count': len(female_list),
        }
        return date_key, result

    # ------------------------------------------------------------------ #
    # 테스트 가능한 파싱 헬퍼 메서드
    # ------------------------------------------------------------------ #

    def _parse_date(self, text: str) -> Optional[datetime]:
        """날짜 문자열을 datetime으로 변환. 실패 시 None 반환."""
        formats = [
            '%Y.%m.%d %H:%M',
            '%Y-%m-%d %H:%M',
            '%Y.%m.%d',
            '%Y-%m-%d',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(text.strip(), fmt)
            except ValueError:
                continue
        return None

    def _extract_price(self, text: str, gender: str = 'male') -> Optional[int]:
        """텍스트에서 성별에 맞는 가격(원)을 추출. 없으면 None.

        '남성: 40,000원 / 여성: 35,000원' 형태를 지원한다.
        gender='male' → 남성 가격, gender='female' → 여성 가격.
        성별 구분이 없는 경우 첫 번째 가격을 반환한다.
        """
        price_re = re.compile(r'([\d,]+)원')

        if gender == 'male':
            # 남성 가격: '남성:' 이후 첫 번째 숫자
            male_m = re.search(r'남성\s*:\s*([\d,]+)원', text)
            if male_m:
                return int(male_m.group(1).replace(',', ''))
        elif gender == 'female':
            # 여성 가격: '여성:' 이후 첫 번째 숫자
            female_m = re.search(r'여성\s*:\s*([\d,]+)원', text)
            if female_m:
                return int(female_m.group(1).replace(',', ''))

        # 성별 구분 없이 첫 번째 가격 반환
        m = price_re.search(text)
        if m:
            return int(m.group(1).replace(',', ''))
        return None

    def _extract_seats(self, text: str) -> Optional[int]:
        """텍스트에서 잔여석 수를 추출. '마감' 등 잔여 없음 표시면 None 반환."""
        if '마감' in text or '완료' in text:
            return None
        m = re.search(r'잔여\s*(\d+)\s*석', text)
        if m:
            return int(m.group(1))
        m2 = re.search(r'(\d+)\s*자리', text)
        if m2:
            return int(m2.group(1))
        return None

    def _parse_participant_list(self, soup: BeautifulSoup) -> dict[str, dict]:
        """
        /list 게시판에서 참가자 현황 테이블 파싱 (레거시 fallback)
        반환: {날짜키: {"male": [...], "female": [...]}}
        """
        result: dict[str, dict] = {}
        tables = soup.select('table')
        for table in tables:
            rows = table.find_all('tr')
            current_date_key = None
            male_list = []
            female_list = []

            for row in rows:
                row_text = row.get_text(separator=' ', strip=True)

                # 날짜 키 추출
                date_m = re.search(r'(\d{1,2})/(\d{1,2})', row_text)
                if date_m and ('소개팅' in row_text or '일정' in row_text or '회차' in row_text):
                    if current_date_key and (male_list or female_list):
                        result[current_date_key] = {'male': male_list, 'female': female_list}
                    current_date_key = f"{date_m.group(1)}/{date_m.group(2)}"
                    male_list = []
                    female_list = []
                    continue

                # 남성 참가자 행: "남", 생년, 직업, 키 패턴
                if '남' in row_text and re.search(r'\d{2}년생|\d{4}년생', row_text):
                    cells = row.find_all(['td', 'th'])
                    entry = self._parse_participant_row(cells)
                    if entry:
                        male_list.append(entry)

                # 여성 참가자 행
                elif '여' in row_text and re.search(r'\d{2}년생|\d{4}년생', row_text):
                    cells = row.find_all(['td', 'th'])
                    entry = self._parse_participant_row(cells)
                    if entry:
                        female_list.append(entry)

            if current_date_key and (male_list or female_list):
                result[current_date_key] = {'male': male_list, 'female': female_list}

        return result

    def _parse_participant_row(self, cells: list) -> Optional[dict]:
        """테이블 행(셀 목록)에서 참가자 정보 딕셔너리 추출"""
        texts = [c.get_text(strip=True) for c in cells if c.get_text(strip=True)]
        if len(texts) < 2:
            return None

        entry: dict = {}
        for t in texts:
            # 생년: 90중반, 95년생 등
            gen_m = re.search(r'(\d{2}(?:년생|대|초반|중반|후반))', t)
            if gen_m:
                entry['generation'] = gen_m.group(1)
            # 키: 160~195 범위
            height_m = re.search(r'(1[6-9]\d)\s*cm?', t)
            if height_m:
                entry['height'] = int(height_m.group(1))
            # 직업 키워드
            job_keywords = ['IT', '개발', '간호', '교사', '교육', '공무원', '의사', '대기업', '중소기업',
                            '프리랜서', '디자인', '영업', '금융', '연구', '회계', '마케팅']
            for kw in job_keywords:
                if kw in t:
                    entry['job'] = t
                    break

        return entry if entry else None

    def _parse_post(self, post_title: str, content: str, source_url: str,
                    thumbnail_url: Optional[str], age_groups: list[str],
                    participant_data: dict[str, dict],
                    description: Optional[str] = None) -> list[EventModel]:
        """월별 일정 게시물 텍스트에서 개별 이벤트 추출 (테이블 파싱 방식)"""
        events = []
        lines = [l.strip() for l in content.split('\n') if l.strip()]

        # 현재 연도/월 파악
        year_match = re.search(r'(\d{4})년', post_title + content)
        month_match = re.search(r'(\d{1,2})월', post_title)
        current_year = int(year_match.group(1)) if year_match else datetime.now().year
        current_month = int(month_match.group(1)) if month_match else datetime.now().month

        # 날짜 + 그룹 패턴 찾기
        # 예: "3/15 로테이션 소개팅 A", "3월 22일", "3.15(토)"
        date_pattern = re.compile(
            r'(?:(\d{1,2})[월/.](\d{1,2})일?)\s*(?:\([월화수목금토일]\))?'
        )

        # 가격 패턴
        price_pattern = re.compile(r'(\d{2,3}),?(\d{3})원?|(\d{4,6})원')

        # 나이대 라벨 패턴 (본문에서)
        age_label_pattern = re.compile(r'([A-D]그룹[^\s,]+|[A-D]그룹\(\d{2,4}[-~]\d{2,4}년생\))')

        for i, line in enumerate(lines):
            date_match = date_pattern.search(line)
            if not date_match:
                continue

            try:
                m = int(date_match.group(1))
                d = int(date_match.group(2))
                # 월이 현재 월이거나 다음 달이면 사용
                if m < 1 or m > 12 or d < 1 or d > 31:
                    continue

                event_date = datetime(current_year, m, d, 14, 0)
                if event_date < datetime.now():
                    continue

                # 제목: 현재 줄 + 앞뒤 컨텍스트
                context_lines = lines[max(0, i-1):i+3]
                title_text = ' '.join(context_lines)[:100]
                title = sanitize_text(f'[연인어때] {title_text}', 80)

                # 가격 추출
                price_text = ' '.join(lines[max(0, i-2):i+5])
                prices = price_pattern.findall(price_text)
                price_male = None
                price_female = None
                if prices:
                    for p in prices:
                        val = int(p[0] + p[1]) if p[0] else int(p[2]) if p[2] else 0
                        if val > 10000:
                            if price_male is None:
                                price_male = val
                            elif price_female is None:
                                price_female = val

                # 지역 추출: 제목의 "지역(요일)" 패턴 우선(구로(금요일)·대전(토요일)·천안(일요일)),
                # 없으면 본문 원문에서 장소/역명 스캔.
                _full_title = f'{title_text} {post_title}'
                _locs = re.findall(r'([가-힣]{2,6})\s*\([월화수목금토일]요일\)', _full_title)
                _phrase = '·'.join(dict.fromkeys(_locs)) if _locs else None
                region = resolve_region(
                    region_phrase=_phrase,
                    title=_full_title,
                    body=content,
                )

                # 나이대 라벨 추출 (본문 라인에서)
                age_group_label = None
                # 테이블(또는 og)에서 파싱한 그룹이 있으면 우선 사용
                if age_groups:
                    # 라인에서 그룹 A/B/C/D 언급 찾기
                    group_m = re.search(r'([A-D])\s*(?:그룹|조|팀)?', title_text)
                    if group_m:
                        group_letter = group_m.group(1)
                        for ag in age_groups:
                            if ag.startswith(group_letter):
                                age_group_label = ag
                                break
                    if not age_group_label and age_groups:
                        age_group_label = age_groups[0]
                # 본문에서 직접 추출
                if not age_group_label:
                    al_m = age_label_pattern.search(title_text)
                    if al_m:
                        age_group_label = al_m.group(1)

                # ─────────────────────────────────────
                # age_range_min / age_range_max 변환
                # ─────────────────────────────────────
                age_range_min, age_range_max = None, None
                if age_group_label:
                    age_range_min, age_range_max = _parse_age_range_from_label(age_group_label)

                # 참가자 현황: 날짜 키로 매칭
                # participant_data 키는 "M/D" 형태
                date_key_str = f"{m}/{d}"
                participant_stats = participant_data.get(date_key_str)

                # 잔여석 정보를 participant_stats에서 추출
                seats_left_male = None
                seats_left_female = None
                if participant_stats:
                    seats_left_male = participant_stats.get('seats_left_male')
                    seats_left_female = participant_stats.get('seats_left_female')

                # source_url에 날짜+시간 포함하여 이벤트마다 유니크하게
                unique_url = f"{source_url}#evt={event_date.strftime('%Y%m%d%H%M')}"
                events.append(EventModel(
                    title=title,
                    description=description,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=unique_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=participant_stats,
                ))

            except (ValueError, IndexError):
                continue

        return events
