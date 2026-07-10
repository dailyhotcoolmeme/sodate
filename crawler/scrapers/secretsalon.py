"""시크릿살롱 (secretsalon.co.kr) 스크래퍼 — imweb 기반, 양재, Playwright"""
import json
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, build_description, extract_description_from_soup
from utils.date_filter import is_within_one_month
from utils.region import resolve_region


class SecretSalonScraper(BaseScraper):
    BASE_URL = 'https://secretsalon.co.kr'
    SHOP_URL = 'https://secretsalon.co.kr/36'

    # 예약위젯(load_option.cm) 실결제가·매진을 정확히 추출 → DB에 기록(모드파티와 동일 정책)
    WRITES_PRICE = True
    WRITES_SEATS = True

    # "2026. 04.02 (THU) 19:30" 또는 "2026.04.02 (THU) 19:30"
    DATE_RE_FULL = re.compile(
        r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*\([A-Z]{3}\)\s*(\d{1,2}):(\d{2})'
    )
    # "2026. 04.02 (THU) 오후 7:30" 패턴
    DATE_RE_AMPM = re.compile(
        r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*\([A-Z]{3}\)\s*(?:오전|오후|저녁)?\s*(\d{1,2}):(\d{2})'
    )
    # "4/2 목 19:30" 또는 "4/2 목 PM 7:30" 형태 (옵션 드롭다운 텍스트)
    DATE_RE_SHORT = re.compile(
        r'(\d{1,2})/(\d{1,2})\s*[월화수목금토일]\s*(?:오전|오후|PM|AM)?\s*(\d{1,2}):(\d{2})'
    )
    # 나이대: "*87년생이하", "만30-39세", "3040특집", "2030특집"
    AGE_RE_BIRTH = re.compile(r'\*?(\d{2})년생이하')
    AGE_RE_RANGE = re.compile(r'만\s*(\d{2,3})\s*[-~]\s*(\d{2,3})\s*세')
    AGE_RE_GROUP = re.compile(r'(20\d0|30\d0|[23][0-9]{3})특집')
    # 나이 "만45세이하"
    AGE_RE_MAX = re.compile(r'만\s*(\d{2,3})\s*세이하')
    # 나이대 괄호 패턴 "(만30-39세)"
    AGE_RE_PAREN = re.compile(r'\(만\s*(\d{2,3})\s*[-~]\s*(\d{2,3})\s*세\)')

    PRICE_RE = re.compile(r'([\d,]+)원')
    PRICE_MALE_RE = re.compile(r'남\s*(?:자|성)?\s*([\d,]+)\s*원')
    PRICE_FEMALE_RE = re.compile(r'여\s*(?:자|성)?\s*([\d,]+)\s*원')
    # 목록/상세 참가자 현황: "남성 16/18 여성 18/18" 또는 "남 16/18 여 18/18"
    SEATS_RE = re.compile(r'남\s*(?:성)?\s*(\d+)/(\d+)[^\d]*여\s*(?:성)?\s*(\d+)/(\d+)')

    def __init__(self):
        super().__init__('secretsalon')

    def _settle(self, page, timeout: int = 6000):
        """imweb은 광고·추적으로 networkidle이 안 잡혀 타임아웃 → 무시하고 진행(콘텐츠는 sleep/selector로 확보)."""
        try:
            page.wait_for_load_state('networkidle', timeout=timeout)
        except PWTimeout:
            pass

    # ── 예약위젯 옵션 AJAX(load_option.cm) 재현 — 날짜→성별→종류 캐스케이드 ──
    # secretsalon body 형식: prod_idx={idx} (모드파티의 type=prod 없음)
    _OPT_FETCH_JS = """async (body) => {
      const r = await fetch('/shop/load_option.cm', {method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
        body});
      return await r.text();
    }"""
    # changeCartSelectRequireOption(idx,'그룹코드','값코드','라벨',...)
    _OC_RE = re.compile(r"changeCartSelectRequireOption\(\d+,'(O[0-9a-fA-F]+)','(O[0-9a-fA-F]+)',\s*'([^']+)'")

    def _load_option_html(self, page, idx: str, sels: list) -> str:
        body = f'prod_idx={idx}'
        for i, (oc, vc, vn) in enumerate(sels):
            body += (f'&selected_require_options[{i}][value_type]=SELECT'
                     f'&selected_require_options[{i}][option_code]={oc}'
                     f'&selected_require_options[{i}][value_code]={vc}'
                     f'&selected_require_options[{i}][value_name]={vn}')
        r = page.evaluate(self._OPT_FETCH_JS, body)
        try:
            return json.loads(r).get('option_html', '') or ''
        except Exception:
            return r or ''

    @staticmethod
    def _date_key(month: int, day: int, hour: int, minute: int) -> str:
        return f'{month:02d}{day:02d}_{hour:02d}{minute:02d}'

    def _gender_prices_by_date(self, page, idx: str) -> dict:
        """예약위젯 캐스케이드(날짜→성별→참여권종류)로 날짜별 성별 대표가 추출.
        대표가 = 그 성별 3단계 옵션 중 최저가(= '1회참여권' 기본가, 동반할인 등 상위상품 제외).
        성별 옵션이 아예 없으면 그 성별은 매진/미제공 → None.
        반환: {date_key('MMDD_HHMM'): {'male': int|None, 'female': int|None}}"""
        out: dict = {}
        # 옵션 라벨은 "7/10 금 19:30" 또는 "7/16 목요일 19:30 (만25-36세)" 형태 → 요일 전체명도 허용
        label_re = re.compile(r'(\d{1,2})/(\d{1,2})\s*[월화수목금토일](?:요일)?\s*(?:오전|오후|PM|AM)?\s*(\d{1,2}):(\d{2})')
        try:
            h1 = self._load_option_html(page, idx, [])
            date_opts = self._OC_RE.findall(h1)
            if not date_opts:
                return out
            grp1 = date_opts[0][0]
            for g1, v1, lab1 in date_opts:
                m = label_re.search(lab1)
                if not m:
                    continue
                key = self._date_key(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)))
                entry = {'male': None, 'female': None, 'age_min': None, 'age_max': None}
                # 날짜 라벨의 "(만25-36세)" → 그 회차의 정확한 나이대(만나이)
                am = re.search(r'만\s*(\d{2,3})\s*[-~]\s*(\d{2,3})\s*세', lab1)
                if am:
                    entry['age_min'] = int(am.group(1))
                    entry['age_max'] = int(am.group(2))
                h2 = self._load_option_html(page, idx, [(g1, v1, lab1)])
                genders = [x for x in self._OC_RE.findall(h2) if x[0] != grp1 and (x[2].startswith('남성') or x[2].startswith('여성'))]
                for g2, gv, glabel in genders:
                    gk = 'male' if glabel.startswith('남성') else 'female'
                    h3 = self._load_option_html(page, idx, [(g1, v1, lab1), (g2, gv, glabel)])
                    # 3단계 '참여권 종류' 옵션 라벨에서 가격 파싱(라벨 예: '1회참여권 69,000원').
                    # 전체 HTML 스캔은 적립금·정가 등 스팸값이 섞이므로 옵션 라벨만 사용.
                    tsoup = BeautifulSoup(h3, 'html.parser')
                    tickets: list[tuple[str, int]] = []
                    for a in tsoup.select('.dropdown-item a'):
                        tl = re.sub(r'\s+', ' ', a.get_text(' ', strip=True))
                        pm = re.search(r'([1-9]\d?,\d{3}|[1-9]\d{4,6})\s*원', tl)
                        if pm:
                            tickets.append((tl, int(pm.group(1).replace(',', ''))))
                    # 기본가 = '1회참여권'으로 시작·'+'/'동반' 없는 옵션(대표 단건 참가비)
                    base = [p for (l, p) in tickets if l.startswith('1회참여권') and '+' not in l and '동반' not in l]
                    if base:
                        entry[gk] = min(base)
                    elif tickets:
                        entry[gk] = min(p for _, p in tickets)  # 폴백: 최저 티켓가
                out[key] = entry
            return out
        except Exception as e:
            self.logger.warning(f'시크릿살롱 성별가격 캐스케이드 실패 idx={idx}: {str(e)[:70]}')
            return out

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                )
                page = context.new_page()

                # 1. 목록 페이지 방문
                page.goto(self.SHOP_URL, timeout=30000, wait_until='domcontentloaded')
                self._settle(page, 10000)
                time.sleep(2)

                products = self._collect_products(page)
                self.logger.info(f'시크릿살롱 상품 {len(products)}개 발견')

                # 2. 각 상품 상세 페이지 방문 (shop/?idx=N 형식 사용)
                for idx, data in products.items():
                    try:
                        detail_url = f'{self.BASE_URL}/shop/?idx={idx}'
                        page.goto(detail_url, timeout=30000, wait_until='domcontentloaded')
                        self._settle(page, 8000)
                        time.sleep(1.5)

                        # 현재 URL이 시크릿살롱이 아닌 외부로 리다이렉트됐는지 확인
                        current_url = page.url
                        if 'secretsalon.co.kr' not in current_url:
                            self.logger.warning(
                                f'시크릿살롱 idx={idx} 외부 URL로 리다이렉트: {current_url}'
                            )
                            # 목록 페이지로 돌아가서 재수집
                            page.goto(self.SHOP_URL, timeout=30000, wait_until='domcontentloaded')
                            self._settle(page, 8000)
                            continue

                        soup = BeautifulSoup(page.content(), 'html.parser')

                        # 드롭다운 옵션 텍스트 수집 (날짜+나이대 포함)
                        option_texts = self._collect_option_texts_via_api(page, idx)
                        # 성별 실결제가(1회참여권) + 매진 — 예약위젯 캐스케이드
                        gender_prices = self._gender_prices_by_date(page, idx)

                        new_events = self._parse_product_page(
                            page, soup, idx, data, option_texts, gender_prices
                        )
                        events.extend(new_events)
                    except Exception as e:
                        self.logger.warning(f'시크릿살롱 idx={idx} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'시크릿살롱 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        filtered = []
        for ev in unique:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'시크릿살롱 총 {len(filtered)}개 이벤트 (필터 전: {len(unique)}개)')
        return filtered

    def _collect_products(self, page) -> dict[str, dict]:
        """목록 페이지에서 idx별 상품 정보 수집."""
        products: dict[str, dict] = {}

        links_data = page.eval_on_selector_all(
            'a[href*="shop/?idx"], a[href*="shop?idx"]',
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
                    'url': f'{self.BASE_URL}/shop/?idx={idx}',
                    'text': text,
                }
        return products

    def _collect_option_texts_via_api(self, page, idx: str) -> list[str]:
        """
        imweb load_option.cm API를 통해 날짜 옵션 텍스트 목록 수집.
        반환: ["4/3 금 19:30", "4/5 일 15:00 (만36-45세)", ...]
        """
        try:
            result = page.evaluate(f'''async () => {{
                try {{
                    const resp = await fetch('/shop/load_option.cm', {{
                        method: 'POST',
                        headers: {{'Content-Type': 'application/x-www-form-urlencoded'}},
                        body: 'prod_idx={idx}'
                    }});
                    const data = await resp.json();
                    return data.option_html || '';
                }} catch(e) {{
                    return '';
                }}
            }}''')

            if not result:
                return []

            # HTML 파싱해서 dropdown-item 텍스트 추출
            soup = BeautifulSoup(result, 'html.parser')
            texts = []
            for item in soup.select('.dropdown-item a span.blocked'):
                txt = item.get_text(strip=True)
                # 날짜 패턴이 포함된 것만
                if self.DATE_RE_SHORT.search(txt) or self.DATE_RE_FULL.search(txt) or self.DATE_RE_AMPM.search(txt):
                    texts.append(txt)
            return texts
        except Exception as e:
            self.logger.debug(f'load_option.cm 실패 idx={idx}: {e}')
            return []

    def _parse_product_page(
        self,
        page,
        soup: BeautifulSoup,
        idx: str,
        listing_data: dict,
        option_texts: list[str],
        gender_prices: Optional[dict] = None,
    ) -> list[EventModel]:
        events: list[EventModel] = []
        now = datetime.now()

        # 썸네일: OG 이미지 우선
        thumbnail_url = None
        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            thumbnail_url = og_img['content']
        if not thumbnail_url:
            for img in soup.find_all('img'):
                src = img.get('src') or img.get('data-src', '')
                if src and 'cdn.imweb.me' in src:
                    thumbnail_url = src if src.startswith('http') else self.BASE_URL + src
                    break

        # 제목
        listing_text = listing_data.get('text', '')
        title_line = ''
        for line in listing_text.split('\n'):
            line = line.strip()
            if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                title_line = line
                break
        if not title_line:
            h1 = soup.find('h1')
            title_line = h1.get_text(strip=True) if h1 else '시크릿살롱 파티'

        # 전체 텍스트 (본문에서 날짜·좌석 추출)
        full_text = soup.get_text(separator='\n', strip=True)

        # 지역 결정 — 공용 해석기 (양재→강남 매핑, 단일 지점이라 결과는 강남 유지)
        region = resolve_region(title=title_line, location_detail='양재', body=full_text)

        # 본문 설명 추출 (og + .detail_detail_wrap 우선, 리뷰영역 회피)
        description = extract_description_from_soup(soup, 6000)

        # 가격 추출
        price_male, price_female = self._extract_prices(full_text + '\n' + listing_text)

        # 상품 레벨 나이대 (기본값) — 전체 텍스트에서 추출
        default_age_label = None
        default_age_min = None
        default_age_max = None
        combined_text_for_age = full_text + '\n' + listing_text
        for line_a in combined_text_for_age.split('\n'):
            lbl = self._extract_age_label(line_a.strip())
            if lbl:
                default_age_label = lbl
                default_age_min, default_age_max = self._parse_age_range(lbl, now.year)
                break

        # 본문 전체의 좌석 현황 (상품 레벨)
        # "남성 X/Y 여성 X/Y" 패턴 — 여러 개 있을 수 있으므로 딕셔너리로 수집
        page_seats: dict[str, tuple[Optional[int], Optional[int]]] = {}
        all_lines = full_text.split('\n')
        for li, line in enumerate(all_lines):
            seats_m = self.SEATS_RE.search(line)
            if seats_m:
                nearby_date = None
                # 앞뒤 3줄에서 날짜 찾기
                for offset in range(-3, 4):
                    ni = li + offset
                    if 0 <= ni < len(all_lines):
                        dm = self.DATE_RE_FULL.search(all_lines[ni]) or \
                             self.DATE_RE_AMPM.search(all_lines[ni]) or \
                             self.DATE_RE_SHORT.search(all_lines[ni])
                        if dm:
                            nearby_date = all_lines[ni].strip()
                            break
                cur_m = int(seats_m.group(1))
                cap_m = int(seats_m.group(2))
                cur_f = int(seats_m.group(3))
                cap_f = int(seats_m.group(4))
                left_m = cap_m - cur_m
                left_f = cap_f - cur_f
                key = nearby_date if nearby_date else f'_seats_{li}'
                page_seats[key] = (left_m, left_f)

        # ── 날짜 이벤트 파싱 ──────────────────────────────────────────────
        # 우선순위: 1) API에서 가져온 option_texts, 2) 본문 날짜 라인
        date_sources: list[str] = []

        if option_texts:
            # API 옵션 텍스트 우선 사용
            date_sources = option_texts
        else:
            # 본문에서 날짜 라인 수집
            for line in all_lines:
                line = line.strip()
                if self.DATE_RE_FULL.search(line) or self.DATE_RE_AMPM.search(line):
                    date_sources.append(line)

        seen_dates: set[str] = set()

        for raw_line in date_sources:
            year = None
            event_date: Optional[datetime] = None

            # 전체 날짜 패턴 우선
            date_m = self.DATE_RE_FULL.search(raw_line)
            if not date_m:
                date_m = self.DATE_RE_AMPM.search(raw_line)

            if date_m:
                try:
                    year = int(date_m.group(1))
                    mo = int(date_m.group(2))
                    d = int(date_m.group(3))
                    hour = int(date_m.group(4))
                    minute = int(date_m.group(5))
                    if not (1 <= mo <= 12 and 1 <= d <= 31):
                        continue
                    event_date = datetime(year, mo, d, hour, minute)
                except ValueError:
                    continue
            else:
                short_m = self.DATE_RE_SHORT.search(raw_line)
                if not short_m:
                    continue
                try:
                    mo = int(short_m.group(1))
                    d = int(short_m.group(2))
                    hour = int(short_m.group(3))
                    minute = int(short_m.group(4))
                    if not (1 <= mo <= 12 and 1 <= d <= 31):
                        continue
                    event_date = datetime(now.year, mo, d, hour, minute)
                    if event_date < now:
                        event_date = datetime(now.year + 1, mo, d, hour, minute)
                    year = event_date.year
                except ValueError:
                    continue

            if event_date is None:
                continue
            if event_date < now:
                continue
            if (event_date - now).days > 365:
                continue

            # 날짜별 나이대 추출 (해당 라인에서) → 없으면 상품 기본값
            age_group_label = default_age_label
            age_range_min = default_age_min
            age_range_max = default_age_max

            line_age = self._extract_age_label(raw_line)
            if line_age:
                age_group_label = line_age
                age_range_min, age_range_max = self._parse_age_range(line_age, year)

            # 좌석 현황: page_seats에서 날짜 라인 매칭 또는 첫 번째 값
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None

            for seat_key, (sl_m, sl_f) in page_seats.items():
                if seat_key and raw_line[:20] in seat_key or seat_key in raw_line:
                    seats_left_male = sl_m
                    seats_left_female = sl_f
                    break

            if seats_left_male is None and len(page_seats) == 1:
                # 날짜가 하나이고 좌석 현황도 하나면 그것을 사용
                (seats_left_male, seats_left_female) = list(page_seats.values())[0]

            # ── 성별 실결제가(1회참여권) + 매진: 예약위젯 캐스케이드 결과로 확정 ──
            # 텍스트 기반 _extract_prices는 부정확(상품표기가·남녀동일) → 위젯가로 덮어씀.
            ev_price_male = price_male
            ev_price_female = price_female
            gp = (gender_prices or {}).get(
                self._date_key(event_date.month, event_date.day, event_date.hour, event_date.minute)
            )
            if gp:
                ev_price_male = gp.get('male')
                ev_price_female = gp.get('female')
                # 위젯에 성별 옵션이 없으면(=매진/미제공) 그 성별 잔여석 0
                if ev_price_male is None:
                    seats_left_male = 0
                if ev_price_female is None:
                    seats_left_female = 0
                # 회차 라벨의 정확한 나이대(만나이)가 있으면 우선 적용
                if gp.get('age_min') is not None and gp.get('age_max') is not None:
                    age_range_min = gp['age_min']
                    age_range_max = gp['age_max']
                    age_group_label = f"만{age_range_min}-{age_range_max}세"

            # 앱 표시용 성별 나이 문자열(시크릿살롱은 이벤트 전체나이 → 남=여 동일)
            age_display = None
            if age_range_min is not None and age_range_max is not None:
                age_display = f'{age_range_min}~{age_range_max}'
            elif age_range_max is not None:
                # 하한이 사이트에 숫자로 없고 그룹(2030/3040)만 있는 경우 → "3040(45세이하)"
                gm = re.search(r'(20\d0|30\d0|40\d0)', title_line)
                age_display = (f'{gm.group(1)}({age_range_max}세이하)' if gm
                               else f'{age_range_max}세이하')

            # 양쪽 마감이면 스킵
            if (seats_left_male is not None and seats_left_female is not None
                    and seats_left_male <= 0 and seats_left_female <= 0):
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 테마
            theme = ['일반']
            lower = (title_line + ' ' + raw_line).lower()
            if '와인' in lower:
                theme = ['와인']
            elif '쿠킹' in lower or '요리' in lower:
                theme = ['쿠킹']

            # participant_stats: 좌석 현황 기반으로 구성
            participant_stats: Optional[dict] = None
            if seats_left_male is not None or seats_left_female is not None:
                participant_stats = {}
                if seats_left_male is not None:
                    participant_stats['seats_left_male'] = max(0, seats_left_male)
                if seats_left_female is not None:
                    participant_stats['seats_left_female'] = max(0, seats_left_female)

            source_url = f'{self.BASE_URL}/shop/?idx={idx}#evt={event_date.strftime("%Y%m%d%H%M")}'
            title = sanitize_text(f'[시크릿살롱] {title_line}', 80)

            try:
                events.append(EventModel(
                    title=title,
                    description=description,
                    event_date=event_date,
                    location_region=region,
                    location_detail='양재',
                    price_male=ev_price_male,
                    price_female=ev_price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=theme,
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_male=age_display,
                    age_female=age_display,
                    participant_stats=participant_stats,
                ))
            except Exception:
                continue

        return events

    def _extract_prices(self, text: str) -> tuple[Optional[int], Optional[int]]:
        """남/여 가격 분리 추출, 없으면 공통 가격 사용."""
        m_male = self.PRICE_MALE_RE.search(text)
        m_female = self.PRICE_FEMALE_RE.search(text)
        price_male = int(m_male.group(1).replace(',', '')) if m_male else None
        price_female = int(m_female.group(1).replace(',', '')) if m_female else None

        if price_male is None and price_female is None:
            prices = [
                int(m.group(1).replace(',', ''))
                for m in self.PRICE_RE.finditer(text)
                if int(m.group(1).replace(',', '')) >= 10000
            ]
            if prices:
                prices = sorted(set(prices))
                price_male = price_female = prices[0]
        elif price_male is None:
            price_male = price_female
        elif price_female is None:
            price_female = price_male

        return price_male, price_female

    def _extract_age_label(self, line: str) -> Optional[str]:
        """라인에서 나이대 라벨 추출."""
        # "(만30-39세)" 괄호 패턴 — 옵션 드롭다운에서 자주 등장
        m = self.AGE_RE_PAREN.search(line)
        if m:
            return f'만{m.group(1)}~{m.group(2)}세'

        # "만30-39세" 패턴
        m = self.AGE_RE_RANGE.search(line)
        if m:
            return f'만{m.group(1)}~{m.group(2)}세'

        # "만45세이하" 패턴
        m = self.AGE_RE_MAX.search(line)
        if m:
            return f'만{m.group(1)}세이하'

        # "*87년생이하" / "87년생이하" 패턴
        m = self.AGE_RE_BIRTH.search(line)
        if m:
            yr = int(m.group(1))
            yr_full = (2000 + yr) if yr <= 30 else (1900 + yr)
            age = datetime.now().year - yr_full
            return f'{yr}년생이하 (만{age}세이하)'

        # "3040특집", "2030특집" 패턴
        m = self.AGE_RE_GROUP.search(line)
        if m:
            group = m.group(1)
            if group.startswith('20'):
                return '20~30대'
            elif group.startswith('30'):
                return '30~40대'
            return group

        return None

    def _parse_age_range(self, age_label: str, year: int) -> tuple[Optional[int], Optional[int]]:
        """나이대 라벨에서 min/max 나이 추출."""
        # "만30~39세" 패턴
        m = re.search(r'만(\d{2,3})[~\-](\d{2,3})세', age_label)
        if m:
            return int(m.group(1)), int(m.group(2))

        # "만45세이하" 패턴
        m = re.search(r'만(\d{2,3})세이하', age_label)
        if m:
            return None, int(m.group(1))

        # "87년생이하" → 나이 변환
        m = re.search(r'(\d{2})년생이하', age_label)
        if m:
            yr = int(m.group(1))
            yr_full = (2000 + yr) if yr <= 30 else (1900 + yr)
            max_age = year - yr_full
            return None, max_age

        # "20~30대"
        if '20~30대' in age_label:
            return 20, 39
        if '30~40대' in age_label:
            return 30, 49

        return None, None
