"""러브캐스팅 (lovecasting.co.kr) 스크래퍼 — WordPress 기반"""
import re
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


class LovecastingScraper(BaseScraper):
    BASE_URL = 'https://lovecasting.co.kr'
    SCHEDULE_URLS = [
        'https://lovecasting.co.kr/커피미팅/',
        'https://lovecasting.co.kr/호프미팅/',
    ]

    REGION_KEYWORDS = ['강남', '홍대', '수원', '대전', '대구', '부산', '인천', '신촌', '잠실', '건대', '성수']
    DATE_PATTERN_FULL = re.compile(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})')
    DATE_PATTERN_SHORT = re.compile(r'(\d{1,2})[월/.](\d{1,2})일?')
    PRICE_PATTERN = re.compile(r'([\d,]+)원')
    # 남 35세~45세 55,000원 / 남자 55,000원 / 여 30세~40세 33,000원
    PRICE_MALE_RE = re.compile(r'남\s*[\d~\-세]*\s*(\d{2,3},\d{3})원|남자\s*(\d{2,3},\d{3})원')
    PRICE_FEMALE_RE = re.compile(r'여\s*[\d~\-세]*\s*(\d{2,3},\d{3})원|여자\s*(\d{2,3},\d{3})원')
    # 나이대: "남 35세~45세" 또는 "남 35~45세" → min=35, max=45
    AGE_RANGE_MALE_RE = re.compile(r'남\s*(\d{2,3})\s*세?\s*[~\-～]\s*(\d{2,3})\s*세')
    AGE_RANGE_FEMALE_RE = re.compile(r'여\s*(\d{2,3})\s*세?\s*[~\-～]\s*(\d{2,3})\s*세')
    # 신청자 수: "남성 현재 N명 신청 접수중"
    APPLICANTS_MALE_RE = re.compile(r'남성\s*현재\s*(\d+)\s*명\s*신청')
    APPLICANTS_FEMALE_RE = re.compile(r'여성\s*현재\s*(\d+)\s*명\s*신청')
    # 총 정원: "남성 N명 / 여성 N명" 또는 "남 N자리"
    CAPACITY_RE = re.compile(r'남\s*(\d+)\s*[명자리]/?\s*여\s*(\d+)\s*[명자리]?')

    def __init__(self):
        super().__init__('lovecasting')

    def scrape(self) -> list[EventModel]:
        events = []
        for schedule_url in self.SCHEDULE_URLS:
            try:
                page_events = self._scrape_category(schedule_url)
                events.extend(page_events)
            except Exception as e:
                self.logger.warning(f'카테고리 크롤링 실패 {schedule_url}: {e}')
        filtered = []
        for ev in events:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'러브캐스팅 총 {len(filtered)}개 이벤트 (필터 전: {len(events)}개)')
        return filtered

    def _scrape_category(self, category_url: str) -> list[EventModel]:
        """카테고리 페이지에서 이벤트 카드 직접 파싱 (러브캐스팅은 단일 페이지 구조)"""
        # 1차: 목록 페이지 카드 직접 파싱 (나이대 + 접수자 수 포함)
        events = self._parse_listing_page(category_url)
        if events:
            self.logger.info(f'러브캐스팅 {category_url} — {len(events)}개 이벤트 (목록 직접 파싱)')
            return events

        # 2차: 페이지 본문 직접 파싱 (기존 방식)
        events = self._fetch_and_parse('러브캐스팅', category_url)
        if events:
            self.logger.info(f'러브캐스팅 {category_url} — {len(events)}개 이벤트 파싱')
            return events

        # 3차: 신청 링크들 수집 → 개별 파싱
        post_links = self._collect_links_static(category_url)
        if not post_links:
            self.logger.info(f'정적 수집 실패, Playwright 시도: {category_url}')
            post_links = self._collect_links_playwright(category_url)

        self.logger.info(f'러브캐스팅 {category_url} — {len(post_links)}개 링크 발견')
        for title, url in post_links[:8]:
            try:
                # URL 자체에 날짜 정보가 있는 경우 URL에서 직접 파싱
                ev = self._event_from_url(title, url)
                if ev:
                    events.append(ev)
                    continue
                parsed = self._fetch_and_parse(title, url)
                events.extend(parsed)
                time.sleep(0.5)
            except Exception as e:
                self.logger.warning(f'게시물 파싱 실패 {url}: {e}')
        return events

    # ─── 목록 페이지 직접 파싱 (카드 구조) ────────────────────────────────────
    # 사이트 구조: 각 카드에 날짜, 제목, 접수 현황(N명 접수중), 남/여 나이대가 포함
    # 예시:
    #   04.04 | 토요일 | PM 5:00 | 삼성역
    #   [커피미팅] 직장인 로테이션 소개팅♥
    #   17명 접수중
    #   남 35세~45세 | 50,000원
    #   여 33세~43세 | 20,000원

    # 카드 날짜: "04.04 | 토요일 | PM 5:00 | 삼성역"
    CARD_DATE_RE = re.compile(r'(\d{1,2})\.(\d{1,2})\s*\|?\s*[월화수목금토일]요일\s*\|?\s*(?:PM|AM)\s*(\d{1,2}):(\d{2})')
    # 접수 현황: "17명 접수중"
    APPLICANTS_COUNT_RE = re.compile(r'(\d+)\s*명\s*접수중')

    def _parse_listing_page(self, category_url: str) -> list[EventModel]:
        """러브캐스팅 목록 페이지에서 이벤트 카드 파싱.
        Playwright 사용 — 나이대와 접수 현황까지 추출.
        """
        events: list[EventModel] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                )
                page = context.new_page()
                page.goto(category_url, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                import time as _time
                _time.sleep(2)

                soup = BeautifulSoup(page.content(), 'html.parser')
                browser.close()

            events = self._extract_cards_from_soup(soup, category_url)
        except Exception as e:
            self.logger.warning(f'목록 페이지 파싱 실패 {category_url}: {e}')
        return events

    def _extract_cards_from_soup(self, soup: BeautifulSoup, category_url: str) -> list[EventModel]:
        """BeautifulSoup에서 러브캐스팅 이벤트 카드 추출."""
        events: list[EventModel] = []
        now = datetime.now()
        current_year = now.year

        # 각 이벤트 블록 탐지: 날짜 + 나이대 정보가 함께 있는 컨테이너
        # 사이트는 각 카드가 별도 div 안에 있음
        # 구조: 날짜줄 / 제목 / 접수현황 / [남 나이대 + 가격 / 여 나이대 + 가격]
        card_containers = soup.select('div.meeting-item, div.post-item, article.post, .entry, div[class*="item"], div[class*="card"], div[class*="post"]')

        if not card_containers:
            # fallback: 날짜 패턴을 포함하는 상위 요소 탐색
            for el in soup.find_all(string=self.CARD_DATE_RE):
                parent = el.parent
                for _ in range(4):
                    if parent and parent.parent:
                        parent = parent.parent
                    else:
                        break
                if parent and parent not in card_containers:
                    card_containers.append(parent)

        seen_dates: set[str] = set()

        for card in card_containers:
            card_text = card.get_text(separator='\n', strip=True)
            lines = [l.strip() for l in card_text.split('\n') if l.strip()]
            if not lines:
                continue

            # 날짜 추출
            event_date = None
            card_date_line = ''
            for line in lines:
                m = self.CARD_DATE_RE.search(line)
                if m:
                    mo, d = int(m.group(1)), int(m.group(2))
                    hour, minute = int(m.group(3)), int(m.group(4))
                    try:
                        event_date = datetime(current_year, mo, d, hour, minute)
                        if event_date < now:
                            event_date = datetime(current_year + 1, mo, d, hour, minute)
                        card_date_line = line
                        break
                    except ValueError:
                        continue

            if not event_date or event_date < now:
                continue

            date_key = event_date.strftime('%Y%m%d%H%M')
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 제목 추출 (링크 텍스트 우선)
            title_text = ''
            link = card.find('a')
            if link:
                title_text = link.get_text(strip=True)
            if not title_text:
                title_text = lines[0] if lines else ''

            post_url = category_url
            if link and link.get('href'):
                href = link['href']
                if not href.startswith('http'):
                    href = urljoin(self.BASE_URL, href)
                post_url = href

            # 접수 현황 (전체 신청자 수)
            total_applicants = None
            for line in lines:
                m_app = self.APPLICANTS_COUNT_RE.search(line)
                if m_app:
                    total_applicants = int(m_app.group(1))
                    break

            # 나이대 파싱 (남/여 각각)
            age_range_min = None
            age_range_max = None
            full_ctx = card_text
            m_age_male = self.AGE_RANGE_MALE_RE.search(full_ctx)
            if m_age_male:
                age_range_min = int(m_age_male.group(1))
                age_range_max = int(m_age_male.group(2))
            else:
                m_age_female = self.AGE_RANGE_FEMALE_RE.search(full_ctx)
                if m_age_female:
                    age_range_min = int(m_age_female.group(1))
                    age_range_max = int(m_age_female.group(2))

            # 가격 파싱
            price_male = None
            price_female = None
            m_male_price = self.PRICE_MALE_RE.search(full_ctx)
            if m_male_price:
                raw = m_male_price.group(1) or m_male_price.group(2) or ''
                if raw:
                    price_male = int(raw.replace(',', ''))
            m_female_price = self.PRICE_FEMALE_RE.search(full_ctx)
            if m_female_price:
                raw = m_female_price.group(1) or m_female_price.group(2) or ''
                if raw:
                    price_female = int(raw.replace(',', ''))

            # fallback 가격
            if price_male is None and price_female is None:
                prices_raw = self.PRICE_PATTERN.findall(full_ctx)
                for raw in prices_raw:
                    val = int(raw.replace(',', ''))
                    if val >= 10000:
                        if price_male is None:
                            price_male = val
                        elif price_female is None:
                            price_female = val

            # 지역
            region = '서울'
            for r in self.REGION_KEYWORDS:
                if r in (card_date_line + title_text):
                    region = r
                    break

            # 썸네일
            thumbnail_url = None
            img = card.find('img')
            if img:
                src = img.get('src', '') or img.get('data-src', '')
                if src and not any(s in src.lower() for s in ['logo', 'icon', 'gravatar']):
                    thumbnail_url = src if src.startswith('http') else urljoin(self.BASE_URL, src)

            title = sanitize_text(f'[러브캐스팅] {title_text}', 80)
            unique_url = f'{post_url}#evt={date_key}'

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
                    theme=['일반'],
                    seats_left_male=None,
                    seats_left_female=None,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats={'total_applicants': total_applicants} if total_applicants else None,
                ))
            except Exception:
                continue

        return events

    def _fetch_thumbnail(self, url: str) -> Optional[str]:
        """페이지에서 썸네일 이미지 URL 추출"""
        thumb, _, _ = self._fetch_page_info(url)
        return thumb

    def _fetch_page_info(self, url: str) -> tuple:
        """한 번의 fetch로 썸네일 + 가격 추출. 반환: (thumbnail_url, price_male, price_female)"""
        thumb: Optional[str] = None
        price_male: Optional[int] = None
        price_female: Optional[int] = None
        try:
            resp = httpx.get(url, timeout=10, follow_redirects=True,
                             headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'})
            soup = BeautifulSoup(resp.text, 'html.parser')
            # 썸네일
            og = soup.select_one('meta[property="og:image"]')
            if og and og.get('content'):
                thumb = og['content']
            if not thumb:
                for img in soup.select('img'):
                    src = img.get('src') or img.get('data-src', '')
                    if not src:
                        continue
                    low = src.lower()
                    if any(skip in low for skip in ['logo', 'icon', 'facebook', 'gravatar', '.gif']):
                        continue
                    if 'wp-content/uploads' in src or 'cdn' in src:
                        thumb = src if src.startswith('http') else urljoin(self.BASE_URL, src)
                        break
            # 가격
            text = soup.get_text(separator='\n')
            m_male = self.PRICE_MALE_RE.search(text)
            if m_male:
                raw = m_male.group(1) or m_male.group(2) or ''
                if raw:
                    price_male = int(raw.replace(',', ''))
            m_female = self.PRICE_FEMALE_RE.search(text)
            if m_female:
                raw = m_female.group(1) or m_female.group(2) or ''
                if raw:
                    price_female = int(raw.replace(',', ''))
            if price_male is None and price_female is None:
                for raw in self.PRICE_PATTERN.findall(text):
                    val = int(raw.replace(',', ''))
                    if val >= 10000:
                        if price_male is None:
                            price_male = val
                        elif price_female is None:
                            price_female = val
                            break
        except Exception:
            pass
        return thumb, price_male, price_female

    def _event_from_url(self, title: str, url: str) -> Optional[EventModel]:
        """URL 슬러그에서 날짜 추출. 예: /26-03-21-커피/ → 2026-03-21"""
        from urllib.parse import unquote
        slug = unquote(url.rstrip('/').split('/')[-1])

        # 패턴1: YY-MM-DD (예: 26-03-21)
        m = re.search(r'(\d{2})-(\d{2})-(\d{2})', slug)
        if m:
            yy, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            year = 2000 + yy
            if 1 <= mo <= 12 and 1 <= d <= 31:
                try:
                    event_date = datetime(year, mo, d, 14, 0)
                    if event_date < datetime.now():
                        return None
                    # 지역
                    region = '서울'
                    for r in self.REGION_KEYWORDS:
                        if r in slug or r in title:
                            region = r
                            break
                    # 썸네일 + 가격 fetch
                    thumbnail_url, price_male, price_female = self._fetch_page_info(url)
                    ev_title = sanitize_text(f'[러브캐스팅] {title or slug}', 80)
                    return EventModel(
                        title=ev_title,
                        event_date=event_date,
                        location_region=region,
                        location_detail=None,
                        price_male=price_male,
                        price_female=price_female,
                        gender_ratio=None,
                        source_url=f'{url}#evt={event_date.strftime("%Y%m%d%H%M")}',
                        thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                        theme=['일반'],
                        seats_left_male=None,
                        seats_left_female=None,
                    )
                except ValueError:
                    pass

        # 패턴2: N월-N일
        m = re.search(r'(\d{1,2})월.{0,3}(\d{1,2})일', slug)
        if not m:
            return None

        mo, d = int(m.group(1)), int(m.group(2))
        if not (1 <= mo <= 12 and 1 <= d <= 31):
            return None

        year = datetime.now().year
        try:
            event_date = datetime(year, mo, d, 14, 0)
            if event_date < datetime.now():
                event_date = datetime(year + 1, mo, d, 14, 0)
        except ValueError:
            return None

        # 지역
        region = '서울'
        for r in self.REGION_KEYWORDS:
            if r in slug or r in title:
                region = r
                break

        thumbnail_url, price_male, price_female = self._fetch_page_info(url)
        return EventModel(
            title=sanitize_text(f'[러브캐스팅] {title or slug}', 80),
            event_date=event_date,
            location_region=region,
            location_detail=None,
            price_male=price_male,
            price_female=price_female,
            gender_ratio=None,
            source_url=f'{url}#evt={event_date.strftime("%Y%m%d%H%M")}',
            thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
            theme=['일반'],
            seats_left_male=None,
            seats_left_female=None,
        )

    def _collect_links_static(self, category_url: str) -> list[tuple[str, str]]:
        """httpx로 WordPress 카테고리 페이지 정적 수집"""
        links = []
        try:
            resp = httpx.get(
                category_url,
                timeout=20,
                follow_redirects=True,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            links = self._extract_links_from_soup(soup)
        except Exception as e:
            self.logger.warning(f'정적 목록 수집 실패 {category_url}: {e}')
        return links

    def _collect_links_playwright(self, category_url: str) -> list[tuple[str, str]]:
        """Playwright로 카테고리 페이지 수집"""
        links = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                )
                page = context.new_page()
                page.goto(category_url, timeout=15000)
                page.wait_for_load_state('networkidle', timeout=10000)
                soup = BeautifulSoup(page.content(), 'html.parser')
                links = self._extract_links_from_soup(soup)
                browser.close()
        except Exception as e:
            self.logger.warning(f'Playwright 목록 수집 실패 {category_url}: {e}')
        return links

    def _extract_links_from_soup(self, soup: BeautifulSoup) -> list[tuple[str, str]]:
        """러브캐스팅 이벤트 링크 추출 — 신청하기 버튼 링크 우선"""
        links = []
        seen = set()

        skip_words = ['/category/', '/tag/', '/author/', '커피미팅/', '호프미팅/', 'mailto:', '#']
        skip_texts = ['신청하기', '로그인', '회원가입', '공지사항', '후기', '카카오', '문의']

        for a in soup.select('a[href]'):
            href = a.get('href', '')
            text = a.get_text(strip=True)
            if not href or not text:
                continue
            if any(s in href for s in skip_words):
                continue
            if any(s in text for s in skip_texts):
                continue
            if not href.startswith('http') and not href.startswith('/'):
                continue
            # 날짜가 포함된 URL (예: /1월-20일-와인...)이거나 일반 포스트 URL
            if not href.startswith('http'):
                href = urljoin(self.BASE_URL, href)
            if 'lovecasting.co.kr' not in href:
                continue
            if href not in seen:
                seen.add(href)
                links.append((text, href))

        # 보완: 페이지 본문 전체를 직접 파싱하도록 빈 리스트로 반환 허용
        return links

    def _fetch_and_parse(self, post_title: str, url: str) -> list[EventModel]:
        """개별 게시물 페이지 파싱"""
        try:
            resp = httpx.get(
                url,
                timeout=20,
                follow_redirects=True,
                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
            )
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, 'html.parser')
            content_text = soup.get_text(separator='\n')

            # 썸네일: OG 이미지 우선, 그 다음 첫 번째 이미지
            thumbnail_url = None
            og_img = soup.select_one('meta[property="og:image"]')
            if og_img and og_img.get('content'):
                thumbnail_url = og_img['content']
            else:
                img = soup.select_one(
                    'article img, .elementor-post img, .wp-post-image, .entry-content img'
                )
                if img:
                    src = img.get('src', '')
                    if src:
                        thumbnail_url = src if src.startswith('http') else urljoin(self.BASE_URL, src)

            return self._parse_content(post_title, content_text, url, thumbnail_url)
        except Exception as e:
            self.logger.warning(f'상세 페이지 fetch 실패 {url}: {e}')
            return []

    def _parse_content(
        self,
        post_title: str,
        content: str,
        source_url: str,
        thumbnail_url: Optional[str],
    ) -> list[EventModel]:
        events = []
        lines = [l.strip() for l in content.split('\n') if l.strip()]

        year_match = re.search(r'(\d{4})년?', post_title + content)
        current_year = int(year_match.group(1)) if year_match else datetime.now().year

        seen_dates: set[str] = set()

        for i, line in enumerate(lines):
            event_date = self._extract_date(line, current_year)
            if not event_date:
                continue

            date_key = event_date.strftime('%Y%m%d%H%M')
            if date_key in seen_dates:
                continue

            if event_date < datetime.now():
                continue

            seen_dates.add(date_key)

            try:
                context_lines = lines[max(0, i - 1):i + 3]
                title_text = ' '.join(context_lines)[:100]
                title = sanitize_text(f'[러브캐스팅] {title_text}', 80)

                price_text = ' '.join(lines[max(0, i - 3):i + 6])
                # 남/여 개별 가격 파싱
                price_male = None
                price_female = None

                # 남성 가격
                m_male_price = self.PRICE_MALE_RE.search(price_text)
                if m_male_price:
                    raw = m_male_price.group(1) or m_male_price.group(2) or ''
                    if raw:
                        price_male = int(raw.replace(',', ''))

                # 여성 가격
                m_female_price = self.PRICE_FEMALE_RE.search(price_text)
                if m_female_price:
                    raw = m_female_price.group(1) or m_female_price.group(2) or ''
                    if raw:
                        price_female = int(raw.replace(',', ''))

                # fallback: 첫 번째/두 번째 가격 순서대로
                if price_male is None and price_female is None:
                    prices_raw = self.PRICE_PATTERN.findall(price_text)
                    for raw in prices_raw:
                        val = int(raw.replace(',', ''))
                        if val >= 10000:
                            if price_male is None:
                                price_male = val
                            elif price_female is None:
                                price_female = val

                # 나이대 파싱
                age_range_min = None
                age_range_max = None
                full_ctx = ' '.join(lines[max(0, i - 5):i + 10])
                m_age_male = self.AGE_RANGE_MALE_RE.search(full_ctx)
                if m_age_male:
                    age_range_min = int(m_age_male.group(1))
                    age_range_max = int(m_age_male.group(2))
                else:
                    m_age_female = self.AGE_RANGE_FEMALE_RE.search(full_ctx)
                    if m_age_female:
                        age_range_min = int(m_age_female.group(1))
                        age_range_max = int(m_age_female.group(2))

                # 신청자 수 → seats_left
                seats_left_male = None
                seats_left_female = None
                m_applicants_m = self.APPLICANTS_MALE_RE.search(full_ctx)
                m_applicants_f = self.APPLICANTS_FEMALE_RE.search(full_ctx)
                m_capacity = self.CAPACITY_RE.search(full_ctx)
                if m_capacity:
                    cap_male = int(m_capacity.group(1))
                    cap_female = int(m_capacity.group(2))
                    if m_applicants_m:
                        seats_left_male = cap_male - int(m_applicants_m.group(1))
                    if m_applicants_f:
                        seats_left_female = cap_female - int(m_applicants_f.group(1))

                region = '서울'
                for r in self.REGION_KEYWORDS:
                    if r in title_text + post_title:
                        region = r
                        break

                unique_url = f"{source_url}#evt={date_key}"
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
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                ))
            except (ValueError, IndexError):
                continue

        # 날짜를 게시물 자체에서 못 찾으면 제목 기반으로 단건 생성 시도
        if not events:
            fallback = self._try_fallback_event(post_title, source_url, thumbnail_url, current_year)
            if fallback:
                events.append(fallback)

        return events

    def _try_fallback_event(
        self,
        post_title: str,
        source_url: str,
        thumbnail_url: Optional[str],
        current_year: int,
    ) -> Optional[EventModel]:
        """제목에서만 날짜를 추출해 단건 이벤트 생성 (최후 수단)"""
        event_date = self._extract_date(post_title, current_year)
        if not event_date or event_date < datetime.now():
            return None

        region = '서울'
        for r in self.REGION_KEYWORDS:
            if r in post_title:
                region = r
                break

        title = sanitize_text(f'[러브캐스팅] {post_title}', 80)
        unique_url = f"{source_url}#evt={event_date.strftime('%Y%m%d%H%M')}"
        try:
            return EventModel(
                title=title,
                event_date=event_date,
                location_region=region,
                location_detail=None,
                price_male=None,
                price_female=None,
                gender_ratio=None,
                source_url=unique_url,
                thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                theme=['일반'],
                seats_left_male=None,
                seats_left_female=None,
            )
        except Exception:
            return None

    def _extract_date(self, line: str, current_year: int) -> Optional[datetime]:
        """줄에서 날짜 추출. 연도 포함 패턴 우선"""
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
