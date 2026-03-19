"""토크블라썸 (talkblossom.co.kr) 스크래퍼 — Cafe24 기반"""
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

        for title, url in post_links[:6]:
            try:
                parsed = self._fetch_and_parse(title, url)
                events.extend(parsed)
                time.sleep(1)
            except Exception as e:
                self.logger.warning(f'게시물 파싱 실패 {url}: {e}')

        return events

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

        # Cafe24 게시판 링크
        selectors = [
            'a[href*="/bbs/board.php"]',
            'a[href*="/product/"]',
            'a[href*="/board/"]',
        ]
        for sel in selectors:
            for a in soup.select(sel):
                href = a.get('href', '')
                title = a.get_text(strip=True)
                if not href or not title:
                    continue
                full_url = href if href.startswith('http') else urljoin(self.BASE_URL, href)
                if full_url not in seen:
                    seen.add(full_url)
                    links.append((title, full_url))

        return links

    def _fetch_and_parse(self, post_title: str, url: str) -> list[EventModel]:
        """개별 게시물/상품 페이지 파싱"""
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

            thumbnail_url = None
            img = soup.select_one('img[src*="talkblossom"], .goods_image img, .board-img img, article img')
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
