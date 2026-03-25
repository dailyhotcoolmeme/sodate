"""감정적인 오렌지들 (emotional0ranges.com) 스크래퍼 — imweb 기반, Playwright

수집 흐름:
1. /date 페이지 → 상품 링크(idx) 목록 수집
2. 각 상품 페이지 → 날짜/나이코드 옵션 + 블로그 참여자 명단 링크 추출
3. 블로그 참여자 명단(네이버 블로그) → 날짜별 participant_stats 파싱
4. 상품 옵션 날짜와 블로그 이벤트 매칭 → EventModel 생성
"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright, Page, Frame
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


# 잔여석 한글 수사 → 정수
SEAT_WORDS = {'한자리': 1, '두자리': 2, '세자리': 3, '네자리': 4, '다섯자리': 5}


class EmotionalOrangeScraper(BaseScraper):
    BASE_URL = 'https://emotional0ranges.com'
    DATE_PAGE_URL = 'https://emotional0ranges.com/date'

    REGION_MAP = {
        '역삼': '강남', '선릉': '강남', '강남': '강남', '서초': '강남',
        '한남': '서울', '용산': '서울', '이태원': '서울',
        '홍대': '홍대', '마포': '홍대', '합정': '홍대',
        '성수': '성수', '건대': '건대',
        '가산': '기타', '구로': '기타', '마곡': '기타', '강서': '기타',
        '동탄': '기타', '화성': '기타', '수원': '수원',
        '부산': '부산', '대구': '대구', '대전': '대전', '인천': '인천',
        '일산': '기타', '고양': '기타', '광주': '기타',
    }

    # "N월 N일" 패턴 (리뷰 제외: [옵션] 으로 시작하는 라인은 과거 리뷰)
    DATE_RE = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    TIME_RE = re.compile(r'(오전|오후|저녁|낮|새벽)\s*(\d{1,2})시(?:\s*(\d{2})분)?')
    PRICE_RE = re.compile(r'([\d,]+)원')
    # 나이 코드 패턴: (나이A), (나이B) ... (나이G)
    AGE_CODE_RE = re.compile(r'\(나이([A-G])\)')
    # 블로그 날짜 패턴 (전체 매치)
    BLOG_DATE_RE = re.compile(
        r'^(\d{1,2})월\s*(\d{1,2})일\s*\((.+?)\)\s*(오전|오후|저녁|낮|새벽)?\s*(\d{1,2})시'
    )
    # 나이 범위 패턴
    AGE_RANGE_RE = re.compile(r'만\s*(\d+)[~\-](\d+)세')

    # 티키타카 소개팅 나이 코드 → (min_age, max_age) 매핑 (만 나이 기준)
    AGE_CODE_MAP: dict[str, tuple[int, int]] = {
        'A': (23, 28),
        'B': (26, 31),
        'C': (29, 34),
        'D': (32, 37),
        'E': (35, 40),
        'F': (38, 43),
        'G': (41, 49),
    }

    def __init__(self):
        super().__init__('emotional-orange')

    # ------------------------------------------------------------------ #
    # 공개 진입점
    # ------------------------------------------------------------------ #

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

                # 1. /date 페이지에서 상품 목록 수집
                page.goto(self.DATE_PAGE_URL, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                time.sleep(2)

                products = self._collect_products(page)
                self.logger.info(f'감정오렌지 상품 {len(products)}개 발견')

                # 블로그 URL → 참여자 통계 캐시 (동일 블로그를 여러 상품이 공유)
                blog_cache: dict[str, dict[str, dict]] = {}

                # 2. 각 상품 페이지에서 날짜 + 블로그 링크 추출
                for idx, data in products.items():
                    try:
                        page.goto(data['url'], timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        time.sleep(1.5)

                        soup = BeautifulSoup(page.content(), 'html.parser')

                        # 블로그 참여자 명단 링크 추출
                        blog_url = self._extract_blog_url(soup)
                        data['blog_url'] = blog_url

                        # 블로그 캐시 활용 (같은 URL은 한 번만 파싱)
                        if blog_url and blog_url not in blog_cache:
                            try:
                                blog_cache[blog_url] = self._fetch_blog_participant_stats(
                                    page, blog_url
                                )
                            except Exception as e:
                                self.logger.warning(
                                    f'감정오렌지 블로그 파싱 실패(idx={idx}): {e}'
                                )
                                blog_cache[blog_url] = {}
                        data['blog_events_map'] = blog_cache.get(blog_url or '', {})

                        new_events = self._parse_product_page(page, soup, idx, data)
                        events.extend(new_events)
                    except Exception as e:
                        self.logger.warning(f'감정오렌지 상품 idx={idx} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'감정오렌지 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [
            ev for ev in events
            if ev.source_url not in seen and not seen.add(ev.source_url)  # type: ignore
        ]
        self.logger.info(f'감정오렌지 총 {len(unique)}개 이벤트')
        return unique

    # ------------------------------------------------------------------ #
    # 상품 목록 수집
    # ------------------------------------------------------------------ #

    def _collect_products(self, page: Page) -> dict[str, dict]:
        """날짜 페이지에서 idx별 상품 정보 수집."""
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

    # ------------------------------------------------------------------ #
    # 블로그 URL 추출
    # ------------------------------------------------------------------ #

    def _extract_blog_url(self, soup: BeautifulSoup) -> Optional[str]:
        """상품 페이지에서 '이번 주 참여자 ... 보러가기' 링크의 블로그 URL 추출."""
        for a in soup.find_all('a', href=re.compile(r'blog\.naver\.com')):
            href = a.get('href', '')
            txt = a.get_text(strip=True)
            # 참여자 명단 링크만 (블로그 홈 제외)
            if re.search(r'/\d{9,}', href):
                return href
        return None

    # ------------------------------------------------------------------ #
    # 상품 페이지 파싱
    # ------------------------------------------------------------------ #

    def _parse_product_page(
        self, page: Page, soup: BeautifulSoup, idx: str, listing_data: dict
    ) -> list[EventModel]:
        events: list[EventModel] = []
        listing_text = listing_data.get('text', '')
        current_year = datetime.now().year
        now = datetime.now()

        # 썸네일
        thumbnail_url = None
        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            thumbnail_url = og_img['content']
        else:
            for img in soup.find_all('img'):
                src = img.get('src') or img.get('data-src', '')
                if src and 'upload' in src and not src.endswith('.gif'):
                    thumbnail_url = src if src.startswith('http') else self.BASE_URL + src
                    break

        # 제목
        title_line = ''
        for line in listing_text.split('\n'):
            line = line.strip()
            if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                title_line = line
                break

        # 가격
        prices = sorted({
            int(m.group(1).replace(',', ''))
            for m in self.PRICE_RE.finditer(listing_text)
            if int(m.group(1).replace(',', '')) >= 10000
        })
        price_male = prices[0] if prices else None
        price_female = prices[1] if len(prices) > 1 else price_male

        # 지역
        region = '서울'
        bracket_m = re.search(r'\[([^\]]+)\]', title_line)
        if bracket_m:
            for kw, region_val in self.REGION_MAP.items():
                if kw in bracket_m.group(1):
                    region = region_val
                    break

        # 테마
        theme = ['일반']
        if '와인' in title_line:
            theme = ['와인']
        elif '쿠킹' in title_line or '요리' in title_line:
            theme = ['쿠킹']

        # 블로그에서 참여자 통계 수집 (scrape()에서 캐시된 데이터 우선 사용)
        blog_events_map: dict[str, dict] = listing_data.get('blog_events_map', {})
        if not blog_events_map:
            blog_url = listing_data.get('blog_url')
            if blog_url:
                try:
                    blog_events_map = self._fetch_blog_participant_stats(page, blog_url)
                except Exception as e:
                    self.logger.warning(f'감정오렌지 블로그 파싱 실패(idx={idx}): {e}')

        # 옵션 목록에서 날짜+나이코드 추출
        option_items = self._extract_option_items(soup)

        seen_dates: set[str] = set()
        for opt_text in option_items:
            date_m = self.DATE_RE.search(opt_text)
            if not date_m:
                continue

            mo, d = int(date_m.group(1)), int(date_m.group(2))
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                continue

            hour, minute = 19, 0
            time_m = self.TIME_RE.search(opt_text)
            if time_m:
                period = time_m.group(1)
                h = int(time_m.group(2))
                minute = int(time_m.group(3)) if time_m.group(3) else 0
                if period in ('오후', '저녁') and h < 12:
                    h += 12
                elif period == '새벽' and h == 12:
                    h = 0
                hour = h

            try:
                event_date = datetime(current_year, mo, d, hour, minute)
                if event_date < now:
                    event_date = datetime(current_year + 1, mo, d, hour, minute)
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 나이 코드 추출 및 매핑
            age_range_min: Optional[int] = None
            age_range_max: Optional[int] = None
            age_group_label: Optional[str] = None
            age_code_m = self.AGE_CODE_RE.search(opt_text)
            if age_code_m:
                code = age_code_m.group(1)
                age_group_label = f'나이{code}'
                if code in self.AGE_CODE_MAP:
                    age_range_min, age_range_max = self.AGE_CODE_MAP[code]

            # 블로그 이벤트 매핑: 날짜+시간으로 lookup
            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            blog_ev = blog_events_map.get(blog_key)

            participant_stats: Optional[dict] = None
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None

            if blog_ev:
                participant_stats = blog_ev.get('participant_stats')
                seats_left_male = blog_ev.get('seats_left_male')
                seats_left_female = blog_ev.get('seats_left_female')
                # 블로그에서 나이 범위를 가져올 수 있으면 우선 적용
                if blog_ev.get('age_range_min') is not None:
                    age_range_min = blog_ev['age_range_min']
                if blog_ev.get('age_range_max') is not None:
                    age_range_max = blog_ev['age_range_max']
                if blog_ev.get('age_group_label') and not age_group_label:
                    age_group_label = blog_ev['age_group_label']

            source_url = (
                f'{self.BASE_URL}/shop_view/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[감정오렌지] {title_line}', 80)

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
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_group_label=age_group_label,
                    participant_stats=participant_stats,
                ))
            except Exception:
                continue

        # 옵션에서 아무것도 못 찾으면 폴백
        if not events:
            events = self._parse_product_page_fallback(
                soup, idx, listing_data,
                title_line, thumbnail_url,
                price_male, price_female, region,
                blog_events_map,
            )
        return events

    # ------------------------------------------------------------------ #
    # 블로그 참여자 명단 수집
    # ------------------------------------------------------------------ #

    def _fetch_blog_participant_stats(
        self, page: Page, blog_url: str
    ) -> dict[str, dict]:
        """네이버 블로그에서 날짜별 참여자 통계를 수집한다.

        반환값: {
            'MMDDH H' (예: '032520'): {
                'participant_stats': {'male': [...], 'female': [...]},
                'seats_left_male': int | None,
                'seats_left_female': int | None,
                'age_range_min': int | None,
                'age_range_max': int | None,
                'age_group_label': str | None,
                'location': str | None,
                'event_type': str | None,
            }
        }
        """
        page.goto(blog_url, timeout=20000)
        time.sleep(4)

        # 네이버 블로그는 PostView iframe 내에 실제 콘텐츠가 있음
        post_frame: Optional[Frame] = None
        for f in page.frames:
            if 'PostView' in f.url:
                post_frame = f
                break

        if post_frame is None:
            self.logger.warning(f'감정오렌지 블로그 PostView 프레임 없음: {blog_url}')
            return {}

        soup = BeautifulSoup(post_frame.content(), 'html.parser')
        return self._parse_blog_soup(soup)

    def _parse_blog_soup(self, soup: BeautifulSoup) -> dict[str, dict]:
        """블로그 BeautifulSoup 객체에서 이벤트별 참여자 통계 추출."""
        result: dict[str, dict] = {}

        for ds in soup.find_all(string=self.BLOG_DATE_RE):
            date_text = ds.strip()
            dm = self.BLOG_DATE_RE.match(date_text)
            if not dm:
                continue

            mo, d = int(dm.group(1)), int(dm.group(2))
            period = dm.group(4) or '저녁'
            hour = int(dm.group(5))
            if period in ('오후', '저녁') and hour < 12:
                hour += 12

            parent = ds.parent
            # 해당 날짜 다음의 첫 번째 참여자 테이블 탐색
            next_table = parent.find_next('table')
            if not next_table:
                continue

            # 테이블이 참여자 테이블인지 확인 (헤더: 남 | 인원 | 여)
            rows = next_table.find_all('tr')
            if not rows:
                continue
            header = [c.get_text(strip=True) for c in rows[0].find_all(['td', 'th'])]
            if '남' not in header:
                continue

            # 날짜와 테이블 사이 텍스트에서 메타 정보 추출
            location, event_type, age_min, age_max, age_group_label = \
                self._extract_between_metadata(parent, next_table)

            # 테이블 파싱
            stats = self._parse_participant_table(next_table)

            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            # 동일 날짜+시간에 여러 이벤트가 있을 경우 첫 번째 우선
            if blog_key not in result:
                # participant_stats 딕셔너리에 잔여석 정보도 포함
                ps: dict = {
                    'male': stats['male'],
                    'female': stats['female'],
                }
                if stats.get('seats_left_male') is not None:
                    ps['seats_left_male'] = stats['seats_left_male']
                if stats.get('seats_left_female') is not None:
                    ps['seats_left_female'] = stats['seats_left_female']

                result[blog_key] = {
                    'participant_stats': ps,
                    'seats_left_male': stats.get('seats_left_male'),
                    'seats_left_female': stats.get('seats_left_female'),
                    'age_range_min': age_min,
                    'age_range_max': age_max,
                    'age_group_label': age_group_label,
                    'location': location,
                    'event_type': event_type,
                }

        return result

    def _extract_between_metadata(
        self, date_parent, next_table
    ) -> tuple[
        Optional[str], Optional[str],
        Optional[int], Optional[int], Optional[str]
    ]:
        """날짜 요소와 다음 테이블 사이의 텍스트에서 지역/이벤트타입/나이범위 추출."""
        between_texts: list[str] = []
        cur = date_parent
        seen_els: set[int] = set()

        while cur and cur != next_table:
            nxt = cur.find_next()
            if nxt is None or nxt == next_table:
                break
            el_id = id(nxt)
            if el_id in seen_els:
                break
            seen_els.add(el_id)
            try:
                if next_table not in nxt.parents:
                    txt = nxt.get_text(strip=True) if hasattr(nxt, 'get_text') else ''
                    if txt and len(txt) < 100 and txt not in between_texts:
                        between_texts.append(txt)
            except Exception:
                pass
            cur = nxt
            if len(between_texts) > 25:
                break

        location: Optional[str] = None
        event_type: Optional[str] = None
        age_min: Optional[int] = None
        age_max: Optional[int] = None
        age_group_label: Optional[str] = None

        for txt in between_texts:
            txt = txt.strip()
            if not txt:
                continue
            # 지역: 순수 한글, 짧음, 코드가 없음
            if (re.match(r'^[가-힣\s]+$', txt)
                    and 3 <= len(txt) <= 12
                    and not location
                    and '초반' not in txt
                    and '중반' not in txt
                    and '후반' not in txt):
                location = txt
            # 이벤트 타입: [xxx] 또는 [ xxx ]
            elif re.match(r'^\[.+\]$', txt) and not event_type:
                event_type = txt[1:-1].strip()
            # 나이 범위
            elif '만' in txt and '세' in txt:
                am = self.AGE_RANGE_RE.search(txt)
                if am:
                    age_min, age_max = int(am.group(1)), int(am.group(2))
                # 나이 그룹 라벨 (🔔티키소개팅 C 등)
                if not age_group_label:
                    label_m = re.search(r'(?:🔔|[A-G])\s*(.+?)(?:\s+남\s*:|$)', txt)
                    if label_m:
                        age_group_label = label_m.group(1).strip()
                    else:
                        # 형태: "🔔티키소개팅 C"
                        lm2 = re.search(r'🔔(.+?)(?:\s|$)', txt)
                        if lm2:
                            age_group_label = lm2.group(1).strip()

        return location, event_type, age_min, age_max, age_group_label

    def _parse_participant_table(self, tbl) -> dict:
        """남 | 인원 | 여 형태의 3열 테이블을 파싱하여 participant_stats 반환."""
        rows = tbl.find_all('tr')
        male_data: list[dict] = []
        female_data: list[dict] = []
        seats_left_male: Optional[int] = None
        seats_left_female: Optional[int] = None

        for row in rows[1:]:  # 헤더 행 건너뜀
            cells = [
                c.get_text(separator=' ', strip=True)
                for c in row.find_all(['td', 'th'])
            ]
            if len(cells) < 3:
                continue

            male_raw = cells[0]
            female_raw = cells[2]

            # 잔여석 추출
            sm = self._extract_seats(male_raw)
            if sm is not None:
                seats_left_male = sm
            sf = self._extract_seats(female_raw)
            if sf is not None:
                seats_left_female = sf

            m_p = self._parse_participant_cell(male_raw)
            f_p = self._parse_participant_cell(female_raw)
            if m_p:
                male_data.append(m_p)
            if f_p:
                female_data.append(f_p)

        result: dict = {'male': male_data, 'female': female_data}
        if seats_left_male is not None:
            result['seats_left_male'] = seats_left_male
        if seats_left_female is not None:
            result['seats_left_female'] = seats_left_female
        return result

    @staticmethod
    def _parse_participant_cell(raw: str) -> Optional[dict]:
        """'90 초반 대기업' → {'generation': '90', 'job': '대기업'}
        generation은 대략적인 출생 연도 2자리 (90초반→'90', 90중반→'93', 90후반→'97').
        """
        raw = raw.strip()
        if not raw:
            return None
        # 마감/잔여석 문구 제외
        skip_keywords = ('마감', '남', '여', '인원', '남았어요', '한자리', '두자리',
                         '세자리', '네자리', '다섯자리')
        if any(kw in raw for kw in skip_keywords):
            return None

        m = re.match(r'^(\d{2})\s*(초반|중반|후반)\s+(.+)$', raw)
        if not m:
            return None

        decade = m.group(1)
        sub = m.group(2)
        job = m.group(3).strip()

        if sub == '초반':
            gen = decade
        elif sub == '중반':
            gen = str(int(decade) + 3).zfill(2)
        elif sub == '후반':
            gen = str(int(decade) + 7).zfill(2)
        else:
            gen = decade

        return {'generation': gen, 'job': job}

    @staticmethod
    def _extract_seats(text: str) -> Optional[int]:
        """'두자리 남았어요 🧡' → 2 / '남성 마감입니다 🧡' → 0 / 기타 → None"""
        if '마감' in text:
            return 0
        for word, count in SEAT_WORDS.items():
            if word in text:
                return count
        m = re.search(r'(\d+)자리', text)
        if m:
            return int(m.group(1))
        return None

    # ------------------------------------------------------------------ #
    # 옵션 항목 추출
    # ------------------------------------------------------------------ #

    def _extract_option_items(self, soup: BeautifulSoup) -> list[str]:
        """상품 옵션 드롭다운/select에서 일시 옵션 텍스트 목록을 추출한다."""
        result: list[str] = []
        seen: set[str] = set()

        # 방법 1: <select> 태그의 <option> 요소
        for sel in soup.find_all('select'):
            for opt in sel.find_all('option'):
                text = opt.get_text(strip=True)
                if self.DATE_RE.search(text) and text not in seen:
                    result.append(text)
                    seen.add(text)

        # 방법 2: 옵션 목록 컨테이너 (JS 렌더링된 li/div 내 텍스트)
        if not result:
            for label in soup.find_all(string=re.compile(r'일시')):
                parent = label.parent
                if parent:
                    container = parent.find_next_sibling()
                    if container:
                        for item in container.find_all(['li', 'option', 'div', 'span']):
                            text = item.get_text(strip=True)
                            if self.DATE_RE.search(text) and text not in seen:
                                result.append(text)
                                seen.add(text)

        # 방법 3: 전체 텍스트에서 옵션 패턴 직접 추출 (최후 수단)
        if not result:
            full_text = soup.get_text(separator='\n', strip=True)
            option_line_re = re.compile(
                r'^\d{1,2}월\s*\d{1,2}일.*?(?:오전|오후|저녁|낮|새벽)\s*\d{1,2}시'
            )
            for line in full_text.split('\n'):
                line = line.strip()
                if line.startswith('[옵션]'):
                    continue
                if option_line_re.match(line) and line not in seen:
                    result.append(line)
                    seen.add(line)

        return result

    # ------------------------------------------------------------------ #
    # 폴백 파싱
    # ------------------------------------------------------------------ #

    def _parse_product_page_fallback(
        self,
        soup: BeautifulSoup,
        idx: str,
        listing_data: dict,
        title_line: str,
        thumbnail_url: Optional[str],
        price_male: Optional[int],
        price_female: Optional[int],
        region: str,
        blog_events_map: dict[str, dict],
    ) -> list[EventModel]:
        """옵션 파싱 실패 시 전체 텍스트에서 이벤트 추출."""
        events: list[EventModel] = []
        text = soup.get_text(separator='\n', strip=True)
        current_year = datetime.now().year
        now = datetime.now()
        seen_dates: set[str] = set()

        theme = ['일반']
        if '와인' in title_line:
            theme = ['와인']
        elif '쿠킹' in title_line or '요리' in title_line:
            theme = ['쿠킹']

        for line in text.split('\n'):
            line = line.strip()
            if not line or line.startswith('[옵션]'):
                continue

            date_m = self.DATE_RE.search(line)
            if not date_m:
                continue

            mo, d = int(date_m.group(1)), int(date_m.group(2))
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                continue

            hour, minute = 19, 0
            time_m = self.TIME_RE.search(line)
            if time_m:
                period = time_m.group(1)
                h = int(time_m.group(2))
                minute = int(time_m.group(3)) if time_m.group(3) else 0
                if period in ('오후', '저녁') and h < 12:
                    h += 12
                elif period == '새벽' and h == 12:
                    h = 0
                hour = h

            try:
                event_date = datetime(current_year, mo, d, hour, minute)
                if event_date < now:
                    event_date = datetime(current_year + 1, mo, d, hour, minute)
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            age_range_min: Optional[int] = None
            age_range_max: Optional[int] = None
            age_group_label: Optional[str] = None
            age_code_m = self.AGE_CODE_RE.search(line)
            if age_code_m:
                code = age_code_m.group(1)
                age_group_label = f'나이{code}'
                if code in self.AGE_CODE_MAP:
                    age_range_min, age_range_max = self.AGE_CODE_MAP[code]

            # 블로그 매핑
            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            blog_ev = blog_events_map.get(blog_key)
            participant_stats: Optional[dict] = None
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None
            if blog_ev:
                participant_stats = blog_ev.get('participant_stats')
                seats_left_male = blog_ev.get('seats_left_male')
                seats_left_female = blog_ev.get('seats_left_female')
                if blog_ev.get('age_range_min') is not None:
                    age_range_min = blog_ev['age_range_min']
                if blog_ev.get('age_range_max') is not None:
                    age_range_max = blog_ev['age_range_max']
                if blog_ev.get('age_group_label') and not age_group_label:
                    age_group_label = blog_ev['age_group_label']

            source_url = (
                f'{self.BASE_URL}/shop_view/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[감정오렌지] {title_line}', 80)

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
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_group_label=age_group_label,
                    participant_stats=participant_stats,
                ))
            except Exception:
                continue

        return events
