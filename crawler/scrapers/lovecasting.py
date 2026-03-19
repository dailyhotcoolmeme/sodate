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
        return events

    def _scrape_category(self, category_url: str) -> list[EventModel]:
        """카테고리 페이지에서 게시물 목록 수집 후 파싱"""
        post_links = self._collect_links_static(category_url)

        if not post_links:
            self.logger.info(f'정적 수집 실패, Playwright 시도: {category_url}')
            post_links = self._collect_links_playwright(category_url)

        self.logger.info(f'러브캐스팅 {category_url} — {len(post_links)}개 게시물 발견')

        events = []
        for title, url in post_links[:6]:
            try:
                parsed = self._fetch_and_parse(title, url)
                events.extend(parsed)
                time.sleep(1)
            except Exception as e:
                self.logger.warning(f'게시물 파싱 실패 {url}: {e}')
        return events

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
        """WordPress 게시물 링크 추출"""
        links = []
        seen = set()

        # WordPress 표준 셀렉터들
        selectors = [
            '.elementor-post a.elementor-post__thumbnail__link',
            '.elementor-post .elementor-post__title a',
            'article a[rel="bookmark"]',
            '.post a[href*="lovecasting.co.kr"]',
            'h2.entry-title a',
            'h3.entry-title a',
            '.wp-block-post-title a',
        ]

        for sel in selectors:
            for a in soup.select(sel):
                href = a.get('href', '')
                title = a.get_text(strip=True) or a.get('title', '') or ''
                if not href:
                    continue
                # 카테고리/태그 페이지 제외
                if any(skip in href for skip in ['/category/', '/tag/', '/author/']):
                    continue
                full_url = href if href.startswith('http') else urljoin(self.BASE_URL, href)
                if full_url not in seen:
                    seen.add(full_url)
                    links.append((title.strip(), full_url))

        # fallback: article 태그 내 링크
        if not links:
            for article in soup.select('article, .elementor-post, .post'):
                a = article.select_one('a[href]')
                if not a:
                    continue
                href = a.get('href', '')
                title_el = article.select_one('h1, h2, h3, h4, .entry-title, [class*="title"]')
                title = title_el.get_text(strip=True) if title_el else a.get_text(strip=True)
                if not href or not title:
                    continue
                if any(skip in href for skip in ['/category/', '/tag/', '/author/']):
                    continue
                full_url = href if href.startswith('http') else urljoin(self.BASE_URL, href)
                if full_url not in seen:
                    seen.add(full_url)
                    links.append((title.strip(), full_url))

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
                    seats_left_male=None,
                    seats_left_female=None,
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
