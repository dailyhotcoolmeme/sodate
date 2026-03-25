"""플리포 (flipo.co.kr) 스크래퍼 — imweb 기반, 수원/천안아산, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


class FlipoScraper(BaseScraper):
    BASE_URL = 'https://flipo.co.kr'

    # 지역별 목록 페이지
    LIST_PAGES = [
        ('https://flipo.co.kr/Fruit', '수원'),
        ('https://flipo.co.kr/vegetable', '천안'),
    ]

    # "2026. 04.06 (SUN)" 또는 "2026.4.6 (SUN)" 또는 "4월 6일(일)"
    DATE_RE_FULL = re.compile(
        r'(\d{4})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})\s*\([A-Z가-힣]{1,3}\)'
    )
    DATE_RE_SHORT = re.compile(
        r'(\d{1,2})월\s*(\d{1,2})일\s*[（(]?[월화수목금토일][）)]?'
    )
    # "03월 22일 일요일 오후 4시" 형식 (flipo 드롭다운 텍스트)
    DATE_RE_OPTION = re.compile(
        r'(\d{1,2})월\s*(\d{1,2})일\s*(?:[월화수목금토일]요일)?\s*(?:오전|오후|저녁)?\s*(\d{1,2})시'
    )
    # "01월03일 토요일 오후6시" 형식 (천안)
    DATE_RE_OPTION2 = re.compile(
        r'(\d{1,2})월(\d{1,2})일\s*[월화수목금토일]요일\s*(?:오전|오후|저녁)(\d{1,2})시'
    )

    # 시간: "19:30", "오후 7:30"
    TIME_RE = re.compile(r'(\d{1,2}):(\d{2})')
    TIME_RE_AMPM = re.compile(r'(오전|오후|저녁)\s*(\d{1,2})시(?:\s*(\d{2})분)?')

    # 일요일 4시 — 플리포 기본 시간
    DEFAULT_HOUR = 16
    DEFAULT_MINUTE = 0

    PRICE_RE = re.compile(r'([\d,]+)원')
    PRICE_MALE_RE = re.compile(r'남\s*(?:자|성)?\s*([\d,]+)\s*원')
    PRICE_FEMALE_RE = re.compile(r'여\s*(?:자|성)?\s*([\d,]+)\s*원')

    # 나이 범위 패턴: "만25~34세", "2535", "3045" (제목/본문)
    AGE_RE_RANGE = re.compile(r'만\s*(\d{2,3})\s*[-~]\s*(\d{2,3})\s*세')
    AGE_RE_SHORT = re.compile(r'(\d{2})(\d{2})\s*(?:특집|소개팅|직장인)?')  # "2535", "3045"
    AGE_RE_BIRTH = re.compile(r'(\d{2})년생\s*이하')
    AGE_RE_MAX = re.compile(r'만\s*(\d{2,3})\s*세이하')
    # 나이A/나이B 패턴 (flipo 천안)
    AGE_LABEL_RE = re.compile(r'(?:나이|age)\s*([AB])', re.IGNORECASE)

    def __init__(self):
        super().__init__('flipo')

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

                for list_url, region in self.LIST_PAGES:
                    try:
                        # 목록 페이지에서 상품 IDX 수집
                        page.goto(list_url, timeout=20000)
                        page.wait_for_load_state('networkidle', timeout=10000)
                        time.sleep(2)

                        products = self._collect_products(page)
                        self.logger.info(f'플리포 {region} 상품 {len(products)}개 발견')

                        for idx, data in products.items():
                            try:
                                # 상품 상세 페이지 접근 (도메인 루트 경로 사용)
                                detail_url = f'{self.BASE_URL}/?idx={idx}'
                                new_events = self._scrape_product_with_options(
                                    page, idx, data, region, detail_url
                                )
                                events.extend(new_events)
                            except Exception as e:
                                self.logger.warning(f'플리포 {region} idx={idx} 파싱 실패: {e}')
                    except Exception as e:
                        self.logger.warning(f'플리포 {region} 목록 수집 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'플리포 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        self.logger.info(f'플리포 총 {len(unique)}개 이벤트')
        return unique

    def _collect_products(self, page) -> dict[str, dict]:
        """목록 페이지에서 idx별 상품 정보 수집."""
        products: dict[str, dict] = {}

        links_data = page.eval_on_selector_all(
            'a[href*="idx"]',
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
                    'url': f'{self.BASE_URL}/?idx={idx}',
                    'text': text,
                }
        return products

    def _scrape_product_with_options(
        self,
        page,
        idx: str,
        listing_data: dict,
        region: str,
        detail_url: str,
    ) -> list[EventModel]:
        """
        상품 상세 페이지에서 Playwright로 날짜 옵션별 재고/성별 정보를 수집합니다.
        - load_option.cm API 응답에서 날짜 목록 추출
        - 각 날짜 클릭 후 성별 드롭다운 HTML에서 품절 여부 파악
        """
        import json as _json

        events: list[EventModel] = []
        now = datetime.now()
        current_year = now.year

        # load_option.cm API 응답 캡처
        captured_options: list[dict] = []

        def on_response(response):
            if 'load_option.cm' in response.url:
                try:
                    body = response.body().decode('utf-8')
                    captured_options.append(_json.loads(body))
                except Exception:
                    pass

        page.on('response', on_response)

        try:
            page.goto(detail_url, timeout=20000)
            page.wait_for_load_state('networkidle', timeout=10000)
            time.sleep(2)
        except Exception as e:
            self.logger.warning(f'플리포 idx={idx} 페이지 로딩 실패: {e}')
            page.remove_listener('response', on_response)
            return events

        html = page.content()
        soup = BeautifulSoup(html, 'html.parser')

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
            if len(line) > 3 and not re.match(r'^[\d,]+원$', line):
                title_line = line
                break
        if not title_line:
            h1 = soup.find('h1')
            title_line = h1.get_text(strip=True) if h1 else f'플리포 {region} 소개팅'

        # SOLDOUT 여부 (목록 기준)
        is_soldout_global = 'SOLDOUT' in listing_text.upper()

        # 전체 텍스트
        full_text = soup.get_text(separator='\n', strip=True)

        # 가격 추출
        price_male, price_female = self._extract_prices(full_text + '\n' + listing_text)

        # 나이대 파싱
        age_range_min, age_range_max, age_group_label = self._extract_age(
            full_text + '\n' + listing_text + '\n' + title_line, current_year
        )

        # load_option.cm 응답에서 날짜 목록 추출
        date_option_items: list[dict] = []
        if captured_options:
            option_html = captured_options[0].get('option_html', '')
            date_option_items = self._parse_date_options_from_html(option_html)
            self.logger.info(f'플리포 idx={idx} 날짜 옵션 {len(date_option_items)}개 발견')

        if not date_option_items:
            # fallback: 본문 텍스트에서 날짜 추출
            page.remove_listener('response', on_response)
            return self._fallback_parse_from_text(
                full_text, idx, listing_data, region, thumbnail_url,
                title_line, price_male, price_female,
                age_range_min, age_range_max, age_group_label,
                is_soldout_global, now, current_year
            )

        # 일시 드롭다운 열기
        page.evaluate("""
            (() => {
                var toggles = document.querySelectorAll('a.dropdown-toggle');
                for (var i = 0; i < toggles.length; i++) {
                    if (toggles[i].textContent.indexOf('\uC77C\uC2DC') > -1) {
                        toggles[i].click();
                        break;
                    }
                }
            })()
        """)
        time.sleep(0.5)

        seen_dates: set[str] = set()

        for opt_idx, opt in enumerate(date_option_items):
            date_text = opt['date_text']
            event_date = self._parse_option_date_text(date_text, current_year, now)

            if event_date is None:
                continue
            if event_date < now:
                continue
            if (event_date - now).days > 365:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 해당 날짜 클릭 후 성별 드롭다운 HTML 가져오기
            gender_status = self._get_gender_status_for_date(page, date_text, opt_idx, len(date_option_items))

            # participant_stats 구성 (품절 여부 정보)
            participant_stats = self._build_participant_stats(gender_status)

            # 잔여석: 남성/여성 품절 여부
            seats_left_male = None
            seats_left_female = None
            if gender_status:
                # 남성 관련 옵션 중 하나라도 가용이면 seats_left > 0, 모두 품절이면 0
                male_opts = {k: v for k, v in gender_status.items() if '남성' in k and '얼리버드' not in k}
                female_opts = {k: v for k, v in gender_status.items() if '여성' in k and '얼리버드' not in k}

                if male_opts:
                    all_male_sold = all(v.get('sold_out', False) for v in male_opts.values())
                    seats_left_male = 0 if all_male_sold else None  # None = 모름(재고있음)
                if female_opts:
                    all_female_sold = all(v.get('sold_out', False) for v in female_opts.values())
                    seats_left_female = 0 if all_female_sold else None

            # 성별 드롭다운에서 실제 가격 추출 (더 정확함)
            actual_price_male = price_male
            actual_price_female = price_female
            if gender_status:
                actual_price_male, actual_price_female = self._extract_prices_from_gender_status(
                    gender_status, price_male, price_female
                )

            is_soldout = is_soldout_global
            # 모든 성별이 품절이면 이벤트 자체 품절
            if seats_left_male == 0 and seats_left_female == 0:
                is_soldout = True

            source_url = f'{self.BASE_URL}/?idx={idx}#evt={event_date.strftime("%Y%m%d%H%M")}'
            title = sanitize_text(f'[플리포] {title_line}', 80)

            # 날짜 텍스트에서 age_group_label 보강 (나이A/나이B)
            age_label = age_group_label
            label_m = self.AGE_LABEL_RE.search(date_text)
            if label_m:
                age_label = f'나이{label_m.group(1)}그룹'

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail='수원 광교' if region == '수원' else '천안/아산',
                    price_male=actual_price_male,
                    price_female=actual_price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_group_label=age_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=participant_stats,
                    is_closed=is_soldout,
                ))
            except Exception:
                continue

        page.remove_listener('response', on_response)
        return events

    def _parse_date_options_from_html(self, option_html: str) -> list[dict]:
        """load_option.cm의 option_html에서 날짜 옵션 목록 파싱."""
        opts = []
        # selectRequireOption 파라미터: ('prod', idx, 'groupId', 'itemId', '날짜텍스트', ...)
        matches = re.findall(
            r"selectRequireOption\('prod',\s*\d+,'([^']+)',\s*'([^']+)',\s*'([^']+)'",
            option_html
        )
        for group_id, item_id, date_text in matches:
            opts.append({
                'group_id': group_id,
                'item_id': item_id,
                'date_text': date_text,
            })
        return opts

    def _get_gender_status_for_date(self, page, date_text: str, opt_idx: int, total_opts: int) -> dict:
        """
        특정 날짜 텍스트를 클릭한 뒤 성별 드롭다운 HTML을 파싱하여
        {성별명: {price, sold_out}} 딕셔너리 반환.
        """
        try:
            # 날짜 링크 클릭
            escaped = date_text.replace("'", "\\'")
            page.evaluate(f"""
                (() => {{
                    var links = document.querySelectorAll('a._requireOption');
                    for (var i = 0; i < links.length; i++) {{
                        if (links[i].textContent.trim() === '{escaped}') {{
                            links[i].click();
                            return 'clicked';
                        }}
                    }}
                }})()
            """)
            time.sleep(0.5)

            # 성별 드롭다운 HTML 가져오기
            gender_html = page.evaluate("""
                (() => {
                    var menus = document.querySelectorAll('.dropdown-menu');
                    for (var i = 0; i < menus.length; i++) {
                        var html = menus[i].outerHTML;
                        if (html.indexOf('\uB0A8\uC131') > -1 || html.indexOf('\uC5EC\uC131') > -1) {
                            return html;
                        }
                    }
                    return null;
                })()
            """)

            status = {}
            if gender_html:
                status = self._parse_gender_dropdown_html(gender_html)

            # 다음 날짜 선택을 위해 일시 드롭다운 다시 열기 (마지막 아닐 때)
            if opt_idx < total_opts - 1:
                page.evaluate("""
                    (() => {
                        var toggles = document.querySelectorAll('a.dropdown-toggle');
                        for (var i = 0; i < toggles.length; i++) {
                            var text = toggles[i].textContent;
                            if (text.indexOf('\uC77C\uC2DC') > -1 || text.indexOf('\uC6D4') > -1) {
                                toggles[i].click();
                                break;
                            }
                        }
                    })()
                """)
                time.sleep(0.3)

            return status
        except Exception as e:
            self.logger.debug(f'성별 드롭다운 파싱 실패 ({date_text}): {e}')
            return {}

    def _parse_gender_dropdown_html(self, gender_html: str) -> dict:
        """
        성별 드롭다운 HTML 파싱.
        반환: {성별명: {price: str, sold_out: bool}}

        품절 판단 기준:
        - cursor: not-allowed 스타일 존재
        - onclick="return false;" 패턴
        - 가격 텍스트에 (품절) 포함
        """
        status = {}
        # 각 dropdown-item 분리
        items = re.findall(r'<div class="dropdown-item[^"]*">(.*?)</div>', gender_html, re.DOTALL)
        for item_html in items:
            # 성별명 추출 (margin-bottom-lg 클래스 span)
            name_m = re.search(r'<span[^>]*margin-bottom[^>]*>([^<]+)</span>', item_html)
            if not name_m:
                continue
            name = name_m.group(1).strip()

            # 가격 추출
            price_m = re.search(r'<strong[^>]*>([^<]+)</strong>', item_html)
            price_text = price_m.group(1).strip() if price_m else ''

            # 품절 판단
            is_sold_out = (
                'cursor: not-allowed' in item_html
                or 'onclick="return false;"' in item_html
                or 'return false' in item_html
                or '품절' in price_text
            )

            status[name] = {
                'price': price_text,
                'sold_out': is_sold_out,
            }
        return status

    def _build_participant_stats(self, gender_status: dict) -> Optional[dict]:
        """
        성별 드롭다운 정보에서 participant_stats 딕셔너리 구성.
        실제 참가자 프로필(직업, 나이)은 플리포가 공개하지 않으므로
        품절/잔여 여부 정보만 저장합니다.
        """
        if not gender_status:
            return None

        stats: dict = {}

        male_sold = None
        female_sold = None
        early_male_sold = None
        early_female_sold = None

        for name, info in gender_status.items():
            sold = info.get('sold_out', False)
            price = info.get('price', '')

            if name == '남성':
                male_sold = sold
            elif name == '여성':
                female_sold = sold
            elif '얼리버드' in name and '남성' in name:
                early_male_sold = sold
            elif '얼리버드' in name and '여성' in name:
                early_female_sold = sold

        if male_sold is not None:
            stats['male_sold_out'] = male_sold
        if female_sold is not None:
            stats['female_sold_out'] = female_sold
        if early_male_sold is not None:
            stats['early_male_sold_out'] = early_male_sold
        if early_female_sold is not None:
            stats['early_female_sold_out'] = early_female_sold

        # seats_left 요약 (품절=0, 가용=재고있음)
        if male_sold is not None:
            stats['seats_left_male'] = 0 if male_sold else None
        if female_sold is not None:
            stats['seats_left_female'] = 0 if female_sold else None

        return stats if stats else None

    def _extract_prices_from_gender_status(
        self,
        gender_status: dict,
        fallback_male: Optional[int],
        fallback_female: Optional[int],
    ) -> tuple[Optional[int], Optional[int]]:
        """
        성별 드롭다운 status에서 남성/여성 정규가 추출.
        얼리버드 제외한 '남성', '여성' 옵션의 가격 사용.
        """
        price_male = fallback_male
        price_female = fallback_female

        for name, info in gender_status.items():
            if '얼리버드' in name:
                continue
            price_text = info.get('price', '')
            # "55,000원" 또는 "55,000원 (품절)" 패턴
            price_m = re.search(r'([\d,]+)원', price_text)
            if not price_m:
                continue
            price_val = int(price_m.group(1).replace(',', ''))
            if price_val < 5000:
                continue
            if name == '남성':
                price_male = price_val
            elif name == '여성':
                price_female = price_val

        return price_male, price_female

    def _parse_option_date_text(self, date_text: str, current_year: int, now: datetime) -> Optional[datetime]:
        """
        드롭다운 날짜 텍스트에서 datetime 파싱.
        예: "03월 22일 일요일 오후 4시", "01월03일 토요일 오후6시(나이A)"
        """
        # "오전/오후/저녁" + 시간 추출
        ampm_m = re.search(r'(오전|오후|저녁)\s*(\d{1,2})시', date_text)
        hour = self.DEFAULT_HOUR
        if ampm_m:
            period = ampm_m.group(1)
            h = int(ampm_m.group(2))
            if period in ('오후', '저녁') and h < 12:
                h += 12
            hour = h

        # 월/일 추출 — 두 가지 형식 시도
        mo, day = None, None

        # 형식 1: "03월 22일"
        m1 = re.search(r'(\d{1,2})월\s*(\d{1,2})일', date_text)
        if m1:
            mo = int(m1.group(1))
            day = int(m1.group(2))

        if mo is None or day is None:
            return None

        try:
            # 과거 날짜는 그대로 반환 (상위 루프에서 event_date < now로 필터)
            # 내년으로 자동 변환하지 않음 — 드롭다운에 있는 날짜는 실제 날짜 그대로
            dt = datetime(current_year, mo, day, hour, 0)
            return dt
        except ValueError:
            return None

    def _extract_age(
        self, text: str, current_year: int
    ) -> tuple[Optional[int], Optional[int], Optional[str]]:
        """나이 범위 파싱."""
        age_range_min = None
        age_range_max = None
        age_group_label = None

        # "만25~34세"
        age_m = self.AGE_RE_RANGE.search(text)
        if age_m:
            age_range_min = int(age_m.group(1))
            age_range_max = int(age_m.group(2))
            age_group_label = f'만{age_range_min}~{age_range_max}세'

        # "만45세이하"
        if not age_group_label:
            age_max_m = self.AGE_RE_MAX.search(text)
            if age_max_m:
                age_range_max = int(age_max_m.group(1))
                age_group_label = f'만{age_range_max}세이하'

        # "87년생이하"
        if not age_group_label:
            age_birth_m = self.AGE_RE_BIRTH.search(text)
            if age_birth_m:
                yr = int(age_birth_m.group(1))
                yr_full = (2000 + yr) if yr <= 30 else (1900 + yr)
                age_range_max = current_year - yr_full + 1
                age_group_label = f'{yr}년생이하'

        return age_range_min, age_range_max, age_group_label

    def _fallback_parse_from_text(
        self,
        full_text: str,
        idx: str,
        listing_data: dict,
        region: str,
        thumbnail_url: Optional[str],
        title_line: str,
        price_male: Optional[int],
        price_female: Optional[int],
        age_range_min: Optional[int],
        age_range_max: Optional[int],
        age_group_label: Optional[str],
        is_soldout: bool,
        now: datetime,
        current_year: int,
    ) -> list[EventModel]:
        """옵션 API 실패 시 본문 텍스트에서 날짜 추출하는 폴백."""
        events: list[EventModel] = []
        seen_dates: set[str] = set()

        for line in full_text.split('\n'):
            line = line.strip()
            if not line:
                continue
            event_date = self._parse_date_from_line(line, current_year)
            if not event_date or event_date < now:
                continue
            if (event_date - now).days > 365:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            source_url = f'{self.BASE_URL}/?idx={idx}#evt={event_date.strftime("%Y%m%d%H%M")}'
            title = sanitize_text(f'[플리포] {title_line}', 80)
            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail='수원 광교' if region == '수원' else '천안/아산',
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    seats_left_male=None,
                    seats_left_female=None,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=None,
                    is_closed=is_soldout,
                ))
            except Exception:
                continue

        return events

    def _parse_date_from_line(self, line: str, current_year: int) -> Optional[datetime]:
        """라인 텍스트에서 날짜+시간 추출."""
        now = datetime.now()

        # "2026.04.06 (SUN)" 패턴
        m_full = self.DATE_RE_FULL.search(line)
        if m_full:
            try:
                year = int(m_full.group(1))
                mo = int(m_full.group(2))
                d = int(m_full.group(3))
                hour, minute = self._extract_time(line)
                return datetime(year, mo, d, hour, minute)
            except ValueError:
                pass

        # "4월 6일(일)" 패턴
        m_short = self.DATE_RE_SHORT.search(line)
        if m_short:
            try:
                mo = int(m_short.group(1))
                d = int(m_short.group(2))
                hour, minute = self._extract_time(line)
                event_date = datetime(current_year, mo, d, hour, minute)
                if event_date < now:
                    event_date = datetime(current_year + 1, mo, d, hour, minute)
                return event_date
            except ValueError:
                pass

        return None

    def _extract_time(self, line: str) -> tuple[int, int]:
        """라인에서 시간 추출. 없으면 플리포 기본 시간(일요일 16:00) 반환."""
        m = self.TIME_RE.search(line)
        if m:
            return int(m.group(1)), int(m.group(2))

        m = self.TIME_RE_AMPM.search(line)
        if m:
            period = m.group(1)
            h = int(m.group(2))
            minute = int(m.group(3)) if m.group(3) else 0
            if period in ('오후', '저녁') and h < 12:
                h += 12
            return h, minute

        return self.DEFAULT_HOUR, self.DEFAULT_MINUTE

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
                # 플리포는 여성가 < 남성가 구조: 낮은 가격 = 여성, 높은 가격 = 남성
                price_female = prices[0]
                price_male = prices[-1]
        elif price_male is None:
            price_male = price_female
        elif price_female is None:
            price_female = price_male

        return price_male, price_female
