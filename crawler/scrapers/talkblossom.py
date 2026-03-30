"""토크블라썸 (talkblossom.co.kr) 스크래퍼 — Cafe24 기반"""
import re
import json
import time
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url
from utils.date_filter import is_within_one_month


class TalkblossomScraper(BaseScraper):
    BASE_URL = 'https://talkblossom.co.kr'
    SCHEDULE_URL = (
        'https://talkblossom.co.kr/category/'
        '%EB%A1%9C%ED%85%8C%EC%9D%B4%EC%85%98-%EC%86%8C%EA%B0%9C%ED%8C%85/42/'
    )

    REGION_KEYWORDS = ['강남', '홍대', '수원', '대전', '대구', '부산', '인천', '신촌', '잠실', '건대', '성수']
    # Cafe24 날짜 패턴: 2025.03.15 / 2025-03-15 / 3월 15일
    DATE_PATTERN_FULL = re.compile(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})')
    DATE_PATTERN_SHORT = re.compile(r'(\d{1,2})[월](\d{1,2})[일]')
    PRICE_PATTERN = re.compile(r'([\d,]+)원')

    def __init__(self):
        super().__init__('talkblossom')

    def scrape(self) -> list[EventModel]:
        events = []
        post_links = self._collect_post_links_static()

        if not post_links:
            self.logger.info('정적 수집 실패, Playwright 시도')
            post_links = self._collect_post_links_playwright()

        self.logger.info(f'토크블라썸 게시물 {len(post_links)}개 발견')

        # 전역 중복 제거 (날짜+시간+나이 조합 기준)
        global_seen: set[str] = set()

        for title, url in post_links[:6]:
            try:
                parsed = self._fetch_and_parse(title, url)
                for ev in parsed:
                    dedup_key = f"{ev.event_date.strftime('%Y%m%d%H%M')}|{ev.age_group_label}"
                    if dedup_key not in global_seen:
                        global_seen.add(dedup_key)
                        events.append(ev)
                time.sleep(1)
            except Exception as e:
                self.logger.warning(f'게시물 파싱 실패 {url}: {e}')

        filtered = []
        for ev in events:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'토크블라썸 총 {len(filtered)}개 이벤트 수집 (필터 전: {len(events)}개)')
        return filtered

    def _collect_post_links_static(self) -> list[tuple[str, str]]:
        """httpx로 목록 페이지 정적 수집"""
        links = []
        try:
            resp = httpx.get(
                self.SCHEDULE_URL,
                timeout=20,
                follow_redirects=True,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            links = self._extract_links_from_soup(soup)
        except Exception as e:
            self.logger.warning(f'정적 목록 수집 실패: {e}')
        return links

    def _collect_post_links_playwright(self) -> list[tuple[str, str]]:
        """Playwright로 목록 페이지 수집"""
        links = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                )
                page = context.new_page()
                page.goto(self.SCHEDULE_URL, timeout=15000)
                page.wait_for_load_state('networkidle', timeout=10000)
                soup = BeautifulSoup(page.content(), 'html.parser')
                links = self._extract_links_from_soup(soup)
                browser.close()
        except Exception as e:
            self.logger.warning(f'Playwright 목록 수집 실패: {e}')
        return links

    def _extract_links_from_soup(self, soup: BeautifulSoup) -> list[tuple[str, str]]:
        """soup에서 Cafe24 게시물/상품 링크 추출"""
        links = []
        seen = set()

        # Cafe24 상품 링크 (/product/상품명/숫자/ 패턴)
        # recent_view_product.html, board/ 링크는 제외
        EXCLUDE_PATTERNS = [
            'recent_view_product',
            '/board/product/',
            '/myshop/',
            '/member/',
            '/order/',
        ]

        selectors = [
            'a[href*="/product/"]',
            'a[href*="/bbs/board.php"]',
        ]
        for sel in selectors:
            for a in soup.select(sel):
                href = a.get('href', '')
                title = a.get_text(strip=True)
                if not href or not title:
                    continue
                # 비상품 URL 제외
                if any(excl in href for excl in EXCLUDE_PATTERNS):
                    continue
                # /product/숫자/ 또는 /product/한글-상품명/숫자/ 패턴만 허용
                if '/product/' in href and not re.search(r'/product/.+/\d+/', href):
                    continue
                full_url = href if href.startswith('http') else urljoin(self.BASE_URL, href)
                if full_url not in seen:
                    seen.add(full_url)
                    links.append((title, full_url))

        return links

    def _parse_option_stock_data(self, html: str) -> list[dict]:
        """
        상품 상세 HTML에서 option_stock_data JS 변수 파싱 (fallback용).
        Playwright로 JS 전역 변수를 직접 읽는 방식(_extract_cafe24_options)이 우선이며,
        이 메서드는 Playwright 실패 시에만 사용된다.

        option_stock_data 구조:
          - key: 옵션 코드 ("P000000R00CR")
          - val.option_value_orginal: ["남자", "3월 28일 토|13:30|01-90|결혼"]
          - val.stock_number: 잔여석 정수
          - val.stock_price: 가격 조정 ("0.00", "-2000.00", "10000.00")

        리뷰필수 옵션(stock_price < 0)은 제외하고 기본 옵션만 수집.
        반환: [{date_str, time_str, age_range, theme, gender, seats_left}]
        """
        options = []
        # Cafe24는 option_stock_data를 문자열로 할당: option_stock_data = '{...}'
        match = re.search(r"option_stock_data\s*=\s*'(\{.+?\})'", html, re.DOTALL)
        if not match:
            match = re.search(r'var\s+option_stock_data\s*=\s*(\{.*?\});', html, re.DOTALL)
        if not match:
            return options
        try:
            raw_str = match.group(1)
            raw_decoded = raw_str.encode().decode('unicode_escape')
            raw_data = json.loads(raw_decoded)
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            try:
                raw_data = json.loads(match.group(1))
            except (json.JSONDecodeError, ValueError):
                return options

        return self._parse_raw_option_stock_data(raw_data)

    def _parse_raw_option_stock_data(self, raw_data: dict) -> list[dict]:
        """
        option_stock_data JSON 딕셔너리를 파싱하여 이벤트 옵션 목록 반환.
        - option_value_orginal[0]: 성별 ("남자" / "여자")
        - option_value_orginal[1]: 일정 "3월 28일 토|13:30|01-90|결혼"
        - stock_number: 잔여석
        - stock_price: 리뷰할인(-2000), 기본(0), 프리미엄(양수)

        동일 날짜+시간+연령대+테마 조합을 하나의 이벤트로 묶고,
        남녀 잔여석을 집계한 뒤 반환한다.
        """
        # schedule_key -> {'male_seats': int, 'female_seats': int, entry fields}
        schedule_map: dict[str, dict] = {}

        for key, val in raw_data.items():
            if not isinstance(val, dict):
                continue

            originals = val.get('option_value_orginal') or []
            if len(originals) < 2:
                # fallback: option_value 직접 파싱 ("남자-날짜|...")
                option_value = val.get('option_value', '')
                if not option_value:
                    continue
                gm = re.match(r'(남자|여자|남성|여성)[-\s](.+)', option_value)
                if gm:
                    originals = [gm.group(1), gm.group(2)]
                else:
                    continue

            gender = originals[0].strip()   # "남자" / "여자"
            schedule_raw = originals[1].strip()  # "3월 28일 토|13:30|01-90|결혼"

            # 리뷰필수 할인 옵션(stock_price < 0) 제외 — 기본 옵션만 사용
            try:
                sp = float(val.get('stock_price', '0') or '0')
            except ValueError:
                sp = 0.0
            if sp < 0:
                continue

            stock_number = int(val.get('stock_number', 0) or 0)

            # 일정 파싱: "3월 28일 토|13:30|01-90|결혼"
            parts = [p.strip() for p in schedule_raw.split('|')]
            date_str = parts[0] if parts else ''
            time_str = parts[1] if len(parts) > 1 else ''
            age_str = parts[2] if len(parts) > 2 else ''
            theme = parts[3] if len(parts) > 3 else '일반'

            # 고유 일정 키 (성별 제외)
            sched_key = f"{date_str}|{time_str}|{age_str}|{theme}"

            if sched_key not in schedule_map:
                entry: dict = {
                    'raw': schedule_raw,
                    'date_str': date_str,
                    'time_str': time_str,
                    'seats_left_male': 0,
                    'seats_left_female': 0,
                }
                # 연령대 파싱
                yr_m = re.match(r'(\d{2})-(\d{2})', age_str)
                if yr_m:
                    y1, y2 = int(yr_m.group(1)), int(yr_m.group(2))
                    current_year = datetime.now().year
                    full_y1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                    full_y2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                    age1 = current_year - full_y1 + 1
                    age2 = current_year - full_y2 + 1
                    entry['age_range'] = age_str
                    entry['age_range_min'] = min(age1, age2)
                    entry['age_range_max'] = max(age1, age2)
                    entry['age_group_label'] = f'{yr_m.group(1)}-{yr_m.group(2)}년생'
                if theme:
                    entry['theme'] = theme
                schedule_map[sched_key] = entry

            # 성별별 잔여석 합산 (같은 일정에 여러 옵션이 있을 수 있으므로 최대값 사용)
            if gender in ('남자', '남성'):
                schedule_map[sched_key]['seats_left_male'] = max(
                    schedule_map[sched_key].get('seats_left_male', 0), stock_number
                )
            elif gender in ('여자', '여성'):
                schedule_map[sched_key]['seats_left_female'] = max(
                    schedule_map[sched_key].get('seats_left_female', 0), stock_number
                )

        return list(schedule_map.values())

    def _fetch_and_parse(self, post_title: str, url: str) -> list[EventModel]:
        """개별 상품 페이지 파싱 — Playwright로 option_stock_data JS 전역 변수 우선 추출.
        Cafe24 실제 구조:
          1단계: Playwright로 window['option_stock_data'] 파싱 → 날짜+잔여석 수집
          2단계: 실패 시 httpx HTML에서 option_stock_data 텍스트 파싱 (fallback)
        """
        try:
            option_list = self._extract_cafe24_options(url)
        except Exception as e:
            self.logger.warning(f'Playwright 옵션 추출 실패 {url}: {e}')
            option_list = []

        # 정적 fetch로 본문 텍스트 + 썸네일 수집
        try:
            resp = httpx.get(
                url,
                timeout=20,
                follow_redirects=True,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
            )
            resp.raise_for_status()
            html = resp.text
            soup = BeautifulSoup(html, 'html.parser')
            content_text = soup.get_text(separator='\n')

            # 이미지: cafe24img.com / ecimg 셀렉터로 수집
            thumbnail_url = None
            img = soup.select_one(
                'img[src*="cafe24img.com"], img[src*="ecimg"], '
                'img[src*="talkblossom"], .goods_image img, .board-img img, article img'
            )
            if img:
                src = img.get('src', '') or img.get('data-src', '')
                if src:
                    thumbnail_url = src if src.startswith('http') else urljoin(self.BASE_URL, src)

            # option_stock_data JS 변수 파싱 (Playwright 실패 시 fallback)
            if not option_list:
                option_list = self._parse_option_stock_data(html)

            return self._parse_content(post_title, content_text, url, thumbnail_url, option_list)
        except Exception as e:
            self.logger.warning(f'상세 페이지 fetch 실패 {url}: {e}')
            return []

    def _extract_cafe24_options(self, url: str) -> list[dict]:
        """Playwright로 Cafe24 상품 상세 페이지에서 option_stock_data JS 전역 변수를 직접 읽어 파싱.

        실제 사이트 구조:
          - 페이지 로드 후 window['option_stock_data'] 가 JSON 문자열로 존재
          - option_value_orginal: ["남자"/"여자", "3월 28일 토|13:30|01-90|결혼"]
          - stock_number: 잔여석 정수
          - stock_price: 기본 옵션 "0.00", 리뷰할인 "-2000.00", 프리미엄 양수

        기존 select#product_option_id1/2 방식은 커스텀 UI 때문에 작동하지 않으므로
        JS 전역 변수 직접 접근으로 대체한다.
        """
        options: list[dict] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                )
                page = context.new_page()
                page.goto(url, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                time.sleep(1)

                # window['option_stock_data'] JS 전역 변수 직접 파싱
                try:
                    raw_data: dict = page.evaluate("""() => {
                        try {
                            if (typeof option_stock_data === 'undefined') return null;
                            if (typeof option_stock_data === 'string') {
                                return JSON.parse(option_stock_data);
                            }
                            return option_stock_data;
                        } catch(e) {
                            return null;
                        }
                    }""")
                    if raw_data:
                        options = self._parse_raw_option_stock_data(raw_data)
                except Exception as e:
                    self.logger.warning(f'option_stock_data JS 파싱 실패: {e}')

                # JS 파싱 실패 시 fallback: select#product_option_id1 "남자" 선택 후 select#product_option_id2 읽기
                if not options:
                    try:
                        page.evaluate("""() => {
                            const sel = document.getElementById('product_option_id1');
                            if (sel) {
                                sel.value = '남자';
                                sel.dispatchEvent(new Event('change', {bubbles: true}));
                            }
                        }""")
                        time.sleep(0.8)
                        raw_options: list[str] = page.eval_on_selector_all(
                            '#product_option_id2 option',
                            "els => els.map(e => e.textContent.trim())"
                            ".filter(t => t && !t.startsWith('-') && !t.startsWith('=')"
                            " && t !== '선택' && !t.includes('[필수]'))"
                        )
                        for raw in raw_options:
                            entry = self._parse_cafe24_option_text(raw)
                            if entry:
                                options.append(entry)
                    except Exception as e:
                        self.logger.warning(f'select fallback 옵션 추출 실패: {e}')

                browser.close()

        except Exception as e:
            self.logger.warning(f'Cafe24 옵션 추출 중 오류: {e}')

        self.logger.info(f'토크블라썸 Cafe24 옵션 {len(options)}개 추출')
        return options

    def _parse_cafe24_option_text(self, raw: str) -> Optional[dict]:
        """Cafe24 옵션 텍스트 파싱.
        형식: "3월 28일 토|13:30|01-90|결혼|리뷰필수 (-2,000원)"
        파이프 구분자: 날짜|시간|연령대(년생범위)|테마|기타
        """
        # 괄호 안 가격 정보 제거 ("(-2,000원)" 등)
        raw_clean = re.sub(r'\s*\([^)]*원[^)]*\)', '', raw).strip()
        parts = [p.strip() for p in raw_clean.split('|')]

        if not parts:
            return None

        entry: dict = {'raw': raw}

        # 첫 번째 파트: 날짜 (예: "3월 28일 토")
        date_str = parts[0]
        entry['date_str'] = date_str

        # 시간
        if len(parts) > 1:
            entry['time_str'] = parts[1].strip()

        # 연령대 (예: "01-90" → 앞이 늦은 년생, 뒤가 이른 년생)
        if len(parts) > 2:
            age_str = parts[2].strip()
            entry['age_range'] = age_str
            # "01-90" 또는 "99-86" 등의 2자리 년생 범위
            yr_m = re.match(r'(\d{2})-(\d{2})', age_str)
            if yr_m:
                y1, y2 = int(yr_m.group(1)), int(yr_m.group(2))
                current_year = datetime.now().year
                # 두 자리 년도 → 4자리 변환 (25 이하면 2000년대, 26 이상이면 1900년대)
                full_y1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                full_y2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                age1 = current_year - full_y1 + 1
                age2 = current_year - full_y2 + 1
                entry['age_range_min'] = min(age1, age2)
                entry['age_range_max'] = max(age1, age2)
                entry['age_group_label'] = f'{yr_m.group(1)}-{yr_m.group(2)}년생'

        # 테마
        if len(parts) > 3:
            entry['theme'] = parts[3].strip()

        return entry

    def _parse_content(
        self,
        post_title: str,
        content: str,
        source_url: str,
        thumbnail_url: Optional[str],
        option_list: Optional[list] = None,
    ) -> list[EventModel]:
        events = []
        lines = [l.strip() for l in content.split('\n') if l.strip()]

        # 연도 파싱: 2024~2027 범위의 4자리 숫자만 허용 (가격/전화번호 오인식 방지)
        year_match = re.search(r'(202[4-9]|203\d)년?', post_title + content)
        current_year = int(year_match.group(1)) if year_match else datetime.now().year

        # option_list에서 이벤트 생성 (옵션이 있을 경우 우선)
        if option_list:
            seen_dates: set[str] = set()
            for opt in option_list:
                date_str = opt.get('date_str', '')
                time_str = opt.get('time_str', '')
                age_group_label = opt.get('age_group_label')
                age_range_min_opt = opt.get('age_range_min')
                age_range_max_opt = opt.get('age_range_max')
                theme_name = opt.get('theme', '일반')

                # 날짜 파싱 (옵션에서)
                event_date = None
                full_text = f"{date_str} {time_str}"
                # 예: "3월 28일 토 18:30"
                m = re.search(r'(\d{1,2})월\s*(\d{1,2})일', full_text)
                t = re.search(r'(\d{1,2}):(\d{2})', full_text)
                if m:
                    try:
                        mo, d = int(m.group(1)), int(m.group(2))
                        hour = int(t.group(1)) if t else 14
                        minute = int(t.group(2)) if t else 0
                        event_date = datetime(current_year, mo, d, hour, minute)
                        # 이미 지난 날짜는 건너뜀 (다음 해로 밀지 않음)
                        if event_date < datetime.now():
                            event_date = None
                    except ValueError:
                        pass

                if not event_date:
                    continue

                date_key = event_date.strftime('%Y%m%d%H%M')
                if date_key in seen_dates:
                    continue
                seen_dates.add(date_key)

                region = '서울'
                for r in self.REGION_KEYWORDS:
                    if r in post_title or r in date_str:
                        region = r
                        break

                # 가격: 본문 전체에서 추출
                prices_raw = self.PRICE_PATTERN.findall(content)
                price_male = None
                price_female = None
                for raw in prices_raw:
                    val = int(raw.replace(',', ''))
                    if val >= 10000:
                        if price_male is None:
                            price_male = val
                        elif price_female is None:
                            price_female = val

                theme_list = [theme_name] if theme_name and theme_name != '일반' else ['일반']
                if '와인' in (theme_name or ''):
                    theme_list = ['와인']

                title = sanitize_text(f'[토크블라썸] {post_title} {date_str}', 80)
                unique_url = f"{source_url}#evt={date_key}"
                # 잔여석 (option_stock_data에서 파싱된 경우)
                seats_left_male = opt.get('seats_left_male')
                seats_left_female = opt.get('seats_left_female')

                # participant_stats: 잔여석 정보만 있을 때는 최소한의 형태로 구성
                participant_stats = None
                if seats_left_male is not None or seats_left_female is not None:
                    participant_stats = {
                        'male': [],
                        'female': [],
                        'seats_left_male': seats_left_male if seats_left_male is not None else 0,
                        'seats_left_female': seats_left_female if seats_left_female is not None else 0,
                    }

                try:
                    events.append(EventModel(
                        title=title,
                        event_date=event_date,
                        location_region=region,
                        location_detail=None,
                        price_male=price_male,
                        price_female=price_female,
                        gender_ratio=None,
                        source_url=unique_url,
                        thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                        theme=theme_list,
                        seats_left_male=seats_left_male,
                        seats_left_female=seats_left_female,
                        age_group_label=age_group_label,
                        age_range_min=age_range_min_opt,
                        age_range_max=age_range_max_opt,
                        participant_stats=participant_stats,
                    ))
                except Exception:
                    continue

            if events:
                return events

        # fallback: 텍스트 파싱 방식
        for i, line in enumerate(lines):
            event_date = self._extract_date(line, current_year)
            if not event_date:
                continue

            if event_date < datetime.now():
                continue

            try:
                context_lines = lines[max(0, i - 1):i + 3]
                title_text = ' '.join(context_lines)[:100]
                title = sanitize_text(f'[토크블라썸] {title_text}', 80)

                price_text = ' '.join(lines[max(0, i - 3):i + 6])
                prices_raw = self.PRICE_PATTERN.findall(price_text)
                price_male = None
                price_female = None
                for raw in prices_raw:
                    val = int(raw.replace(',', ''))
                    if val >= 10000:
                        if price_male is None:
                            price_male = val
                        elif price_female is None:
                            price_female = val

                region = '서울'
                for r in self.REGION_KEYWORDS:
                    if r in title_text:
                        region = r
                        break

                # 나이대 라벨: "99-86년생(25-38세)" 패턴
                age_group_label = None
                age_m = re.search(r'(\d{2}-\d{2}년생(?:\(\d{2}-\d{2}세\))?)', title_text + content[:500])
                if age_m:
                    age_group_label = age_m.group(1)

                unique_url = f"{source_url}#evt={event_date.strftime('%Y%m%d%H%M')}"
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=unique_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    seats_left_male=None,
                    seats_left_female=None,
                    age_group_label=age_group_label,
                ))
            except (ValueError, IndexError):
                continue

        return events

    def _extract_date(self, line: str, current_year: int) -> Optional[datetime]:
        """줄에서 날짜 추출. 연도 포함 패턴 우선, 없으면 월일 패턴"""
        m = self.DATE_PATTERN_FULL.search(line)
        if m:
            try:
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if 1 <= mo <= 12 and 1 <= d <= 31:
                    return datetime(y, mo, d, 14, 0)
            except ValueError:
                pass

        m = self.DATE_PATTERN_SHORT.search(line)
        if m:
            try:
                mo, d = int(m.group(1)), int(m.group(2))
                if 1 <= mo <= 12 and 1 <= d <= 31:
                    return datetime(current_year, mo, d, 14, 0)
            except ValueError:
                pass

        return None
