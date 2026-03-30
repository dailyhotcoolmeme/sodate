"""인썸파티 (inssumparty.co.kr) 스크래퍼 — imweb 기반, 대전, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month


class InssumPartyScraper(BaseScraper):
    BASE_URL = 'https://www.inssumparty.co.kr'
    LIST_URL = 'https://www.inssumparty.co.kr/party'
    # 인썸파티 자체 도메인 — 외부 리다이렉트 감지용
    OWN_HOST = 'www.inssumparty.co.kr'

    REGION_MAP = {
        '대전': '대전', '유성': '대전', '둔산': '대전',
        '서울': '서울', '강남': '강남', '홍대': '홍대',
        '수원': '수원', '부산': '부산',
    }

    # "3월 21일(토) 20:00" 패턴
    DATE_RE1 = re.compile(r'(\d{1,2})월\s*(\d{1,2})일[^,\n]*?(\d{1,2}):(\d{2})')
    # "3/21(토)" — 반드시 요일 표기 있어야 함
    DATE_RE2 = re.compile(r'(\d{1,2})/(\d{1,2})\s*[（(][월화수목금토일]')
    PRICE_RE = re.compile(r'([\d,]+)원')
    # "남 35/40 여 37/40" — 목록/상세 공용
    SEATS_RE = re.compile(r'남\s*(\d+)/(\d+)\s*여\s*(\d+)/(\d+)')
    # 나이대: "남 02~88년생" → "02~88년생"
    AGE_RE = re.compile(r'(?:남|여)\s*(\d{2}[~\-]\d{2}년생)')
    # "대상 : 남 02~88년생[,\s]+여 02~88년생" 패턴 (상세 본문)
    AGE_TARGET_RE = re.compile(
        r'대상\s*[:\-]?\s*남\s*(\d{2})[~\-](\d{2})년생'
        r'(?:.*?여\s*(\d{2})[~\-](\d{2})년생)?',
        re.DOTALL,
    )
    # 성별 드롭다운 가격: "남자 55,000원" / "여자 33,000원"
    PRICE_MALE_RE = re.compile(r'남\s*(?:자|성)?\s*([\d,]+)\s*원')
    PRICE_FEMALE_RE = re.compile(r'여\s*(?:자|성)?\s*([\d,]+)\s*원')

    def __init__(self):
        super().__init__('inssumparty')

    # ------------------------------------------------------------------
    # 메인 scrape
    # ------------------------------------------------------------------
    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent=(
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/121.0.0.0 Safari/537.36'
                    ),
                )
                page = context.new_page()

                # 리스팅 페이지
                page.goto(self.LIST_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(3)

                products = self._collect_products(page)
                self.logger.info(f'인썸파티 상품 {len(products)}개 발견')

                for idx, data in products.items():
                    try:
                        page.goto(data['url'], timeout=15000)
                        page.wait_for_load_state('domcontentloaded', timeout=8000)
                        time.sleep(2)

                        # 외부 사이트로 리다이렉트된 경우 건너뜀
                        current_url = page.url
                        if self.OWN_HOST not in current_url:
                            self.logger.debug(
                                f'인썸파티 idx={idx} 외부 리다이렉트 감지 → 스킵 ({current_url})'
                            )
                            continue

                        html = page.content()
                        soup = BeautifulSoup(html, 'html.parser')
                        thumbnail_url = self._get_thumbnail(soup, page)
                        new_events = self._parse_product(soup, page, idx, data, thumbnail_url)
                        events.extend(new_events)
                    except Exception as e:
                        self.logger.warning(f'인썸파티 idx={idx} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'인썸파티 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [
            ev for ev in events
            if ev.source_url not in seen and not seen.add(ev.source_url)  # type: ignore
        ]
        filtered = []
        for ev in unique:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'인썸파티 총 {len(filtered)}개 이벤트 (필터 전: {len(unique)}개)')
        return filtered

    # ------------------------------------------------------------------
    # 썸네일 수집
    # ------------------------------------------------------------------
    def _get_thumbnail(self, soup: BeautifulSoup, page) -> Optional[str]:
        og = soup.select_one('meta[property="og:image"]')
        if og and og.get('content'):
            return og['content']
        img = soup.select_one('img[src*="cdn.imweb.me"]')
        if img:
            src = img.get('src', '')
            if src:
                return src
        try:
            imgs = page.eval_on_selector_all(
                'img[src*="cdn.imweb.me"]',
                'els => els.map(e => e.src)'
            )
            if imgs:
                return imgs[0]
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # 목록 페이지에서 상품 URL/텍스트 수집
    # ------------------------------------------------------------------
    def _collect_products(self, page) -> dict[str, dict]:
        products: dict[str, dict] = {}
        links_data = page.eval_on_selector_all(
            'a[href*="shop_view"]',
            'els => els.map(e => ({href: e.href, text: e.innerText.trim()}))'
        )
        for item in links_data:
            href = item['href']
            text = item['text']
            idx_m = re.search(r'idx=(\d+)', href)
            if not idx_m:
                continue
            idx = idx_m.group(1)
            if idx not in products or len(text) > len(products[idx].get('text', '')):
                products[idx] = {
                    'url': f'{self.BASE_URL}/shop_view/?idx={idx}',
                    'text': text,
                }
        return products

    # ------------------------------------------------------------------
    # 신청 버튼 클릭 후 팝업/상세에서 participant_stats 수집
    # ------------------------------------------------------------------
    def _collect_participant_stats(
        self,
        page,
        soup: BeautifulSoup,
        seats_info: dict,
    ) -> Optional[dict]:
        """
        인썸파티 상세 페이지 본문 텍스트에서 참가자 현황을 파싱합니다.

        상세 본문에는 아래와 같은 형식이 나올 수 있습니다:
          남성🙆‍♂️ | 여성🙆‍♀️
          01호 해외영업(176) | 회사원(166)
          02호 모집중 | 모집중

        단, 인썸파티 자체 상세 페이지에서는 이 정보가 공개되지 않습니다.
        공개된 경우에만 파싱하여 반환하고, 없으면 seats 기반의 요약 dict를 반환합니다.
        """
        text = soup.get_text(separator='\n', strip=True)

        # "01호 직업(키) | 직업(키)" 패턴 파싱
        # 남 | 여 형식 라인
        ROW_RE = re.compile(
            r'\d+호\s+(.+?)\((\d{2,3})\)\s*[|｜]\s*(.+?)(?:\((\d{2,3})\))?'
        )
        male_list = []
        female_list = []
        for line in text.split('\n'):
            m = ROW_RE.search(line)
            if not m:
                continue
            male_job = m.group(1).strip()
            male_height_str = m.group(2)
            female_job = m.group(3).strip()
            female_height_str = m.group(4)
            # "모집중" 등 미확정은 포함하지 않음
            if male_job and '모집중' not in male_job:
                entry: dict = {'job': male_job}
                if male_height_str:
                    try:
                        entry['height'] = int(male_height_str)
                    except ValueError:
                        pass
                male_list.append(entry)
            if female_job and '모집중' not in female_job and '확인중' not in female_job:
                entry_f: dict = {'job': female_job}
                if female_height_str:
                    try:
                        entry_f['height'] = int(female_height_str)
                    except ValueError:
                        pass
                female_list.append(entry_f)

        stats: dict = {}
        if male_list:
            stats['male'] = male_list
        if female_list:
            stats['female'] = female_list

        # seats 정보 병합
        if seats_info.get('seats_left_male') is not None:
            stats['seats_left_male'] = seats_info['seats_left_male']
        if seats_info.get('seats_left_female') is not None:
            stats['seats_left_female'] = seats_info['seats_left_female']
        if seats_info.get('capacity_male') is not None:
            stats['capacity_male'] = seats_info['capacity_male']
        if seats_info.get('capacity_female') is not None:
            stats['capacity_female'] = seats_info['capacity_female']

        return stats if stats else None

    # ------------------------------------------------------------------
    # 상세 페이지에서 seats 파싱 (날짜별 매핑)
    # ------------------------------------------------------------------
    def _parse_seats_by_date(self, text: str, listing_text: str) -> dict[str, dict]:
        """
        텍스트에서 날짜별 seats 현황을 매핑합니다.

        반환: { "3/28": {"cur_m": 35, "cap_m": 40, "cur_f": 37, "cap_f": 40}, ... }
        """
        result: dict[str, dict] = {}
        combined = text + '\n' + listing_text

        # 줄 단위로 날짜 + seats 패턴 탐색
        DATE_INLINE_RE = re.compile(
            r'(\d{1,2})[/월]\s*(\d{1,2})'
            r'.*?남\s*(\d+)/(\d+)\s*여\s*(\d+)/(\d+)'
        )
        # 날짜 라인 다음 줄에 seats가 오는 경우
        lines = combined.split('\n')
        for i, line in enumerate(lines):
            m = DATE_INLINE_RE.search(line)
            if m:
                mo_s = m.group(1).zfill(2)
                d_s = m.group(2).zfill(2)
                key = f'{mo_s}/{d_s}'
                result[key] = {
                    'cur_m': int(m.group(3)), 'cap_m': int(m.group(4)),
                    'cur_f': int(m.group(5)), 'cap_f': int(m.group(6)),
                }
                continue

            # 날짜만 있는 라인: 이후 3줄 내 seats 패턴 탐색
            date_only = re.search(r'(\d{1,2})[/월]\s*(\d{1,2})', line)
            if date_only:
                mo_s = date_only.group(1).zfill(2)
                d_s = date_only.group(2).zfill(2)
                key = f'{mo_s}/{d_s}'
                nearby = '\n'.join(lines[i:i+4])
                seats_m = self.SEATS_RE.search(nearby)
                if seats_m:
                    result[key] = {
                        'cur_m': int(seats_m.group(1)), 'cap_m': int(seats_m.group(2)),
                        'cur_f': int(seats_m.group(3)), 'cap_f': int(seats_m.group(4)),
                    }

        return result

    # ------------------------------------------------------------------
    # 상품 파싱 (메인)
    # ------------------------------------------------------------------
    def _parse_product(
        self,
        soup: BeautifulSoup,
        page,
        idx: str,
        listing: dict,
        thumbnail_url: Optional[str] = None,
    ) -> list[EventModel]:
        events: list[EventModel] = []
        text = soup.get_text(separator='\n', strip=True)
        listing_text = listing.get('text', '')
        current_year = datetime.now().year
        now = datetime.now()

        # 제목
        title_line = ''
        for line in listing_text.split('\n'):
            line = line.strip()
            if len(line) > 5 and not re.match(r'^[\d,]+원$', line) and not re.match(r'^\d+/\d+', line):
                title_line = line
                break

        full_text = text + '\n' + listing_text

        # ── 가격 파싱 ──────────────────────────────────────────────
        price_male = None
        price_female = None
        m_male = self.PRICE_MALE_RE.search(full_text)
        m_female = self.PRICE_FEMALE_RE.search(full_text)
        if m_male:
            price_male = int(m_male.group(1).replace(',', ''))
        if m_female:
            price_female = int(m_female.group(1).replace(',', ''))

        if price_male is None and price_female is None:
            prices = [
                int(m.group(1).replace(',', ''))
                for m in self.PRICE_RE.finditer(listing_text)
                if int(m.group(1).replace(',', '')) >= 10000
            ]
            prices = sorted(set(prices))
            price = prices[0] if prices else None
            price_male = price_female = price
        elif price_male is None:
            price_male = price_female
        elif price_female is None:
            price_female = price_male

        # ── 나이대 파싱 ────────────────────────────────────────────
        age_group_label = None

        # 패턴1: "대상 : 남 02~88년생, 여 02~88년생"
        target_m = self.AGE_TARGET_RE.search(text)
        if target_m:
            yr_start, yr_end = target_m.group(1), target_m.group(2)
            age_group_label = f'{yr_start}~{yr_end}년생'

        # 패턴2: "남 02~88년생" (목록/상세 단독)
        if not age_group_label:
            age_m = self.AGE_RE.search(full_text)
            if age_m:
                age_group_label = age_m.group(1)

        # 나이 범위 → 실제 나이(한국 나이) 변환
        age_range_min = None
        age_range_max = None
        if age_group_label:
            yr_m = re.search(r'(\d{2})[~\-](\d{2})년생', age_group_label)
            if yr_m:
                yr1, yr2 = int(yr_m.group(1)), int(yr_m.group(2))
                yr1_full = (2000 + yr1) if yr1 <= 30 else (1900 + yr1)
                yr2_full = (2000 + yr2) if yr2 <= 30 else (1900 + yr2)
                cur_year = datetime.now().year
                age1 = cur_year - yr1_full + 1
                age2 = cur_year - yr2_full + 1
                age_range_min = min(age1, age2)
                age_range_max = max(age1, age2)

        # ── 지역 파싱 ──────────────────────────────────────────────
        region = '대전'
        for kw, region_val in self.REGION_MAP.items():
            if kw in title_line or kw in full_text:
                region = region_val
                break

        # ── 날짜별 seats 매핑 ──────────────────────────────────────
        seats_map = self._parse_seats_by_date(text, listing_text)

        # ── 날짜+시간 파싱 ──────────────────────────────────────────
        seen_dates: set[str] = set()
        for line in text.split('\n'):
            line = line.strip()
            if not line or line.startswith('[옵션]'):
                continue

            # "🕛 3월 21일(토) 20:00-22:00" 패턴
            date_m = self.DATE_RE1.search(line)
            if date_m:
                mo = int(date_m.group(1))
                d = int(date_m.group(2))
                hour = int(date_m.group(3))
                minute = int(date_m.group(4))
            else:
                # "3/21(토)" 패턴 (시간 기본값 20:00)
                date_m2 = self.DATE_RE2.search(line)
                if not date_m2:
                    continue
                mo = int(date_m2.group(1))
                d = int(date_m2.group(2))
                hour, minute = 20, 0

            if not (1 <= mo <= 12 and 1 <= d <= 31):
                continue

            try:
                event_date = datetime(current_year, mo, d, hour, minute)
                if event_date < now:
                    event_date = datetime(current_year + 1, mo, d, hour, minute)
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            # ── seats 현황 (날짜별 매핑 우선, fallback은 전체 텍스트 첫 번째 매치)
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None
            capacity_male: Optional[int] = None
            capacity_female: Optional[int] = None

            date_key_short = f'{str(mo).zfill(2)}/{str(d).zfill(2)}'
            seats_data = seats_map.get(date_key_short)
            if not seats_data:
                # fallback: 전체 텍스트에서 첫 번째 매치
                seats_m_all = self.SEATS_RE.search(full_text)
                if seats_m_all:
                    seats_data = {
                        'cur_m': int(seats_m_all.group(1)),
                        'cap_m': int(seats_m_all.group(2)),
                        'cur_f': int(seats_m_all.group(3)),
                        'cap_f': int(seats_m_all.group(4)),
                    }

            if seats_data:
                cur_m = seats_data['cur_m']
                cap_m = seats_data['cap_m']
                cur_f = seats_data['cur_f']
                cap_f = seats_data['cap_f']
                seats_left_male = cap_m - cur_m
                seats_left_female = cap_f - cur_f
                capacity_male = cap_m
                capacity_female = cap_f
                # 양쪽 모두 마감이면 스킵
                if seats_left_male <= 0 and seats_left_female <= 0:
                    continue

            # ── participant_stats 수집 ─────────────────────────────
            seats_info = {
                'seats_left_male': seats_left_male,
                'seats_left_female': seats_left_female,
                'capacity_male': capacity_male,
                'capacity_female': capacity_female,
            }
            participant_stats = self._collect_participant_stats(page, soup, seats_info)

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            theme = ['와인'] if '와인' in title_line else ['일반']
            source_url = (
                f'{self.BASE_URL}/shop_view/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[인썸파티] {title_line}', 80)

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=theme,
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    capacity_male=capacity_male,
                    capacity_female=capacity_female,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=participant_stats,
                ))
            except Exception:
                continue

        return events
