"""모드파티 (modparty.co.kr) 스크래퍼"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url


class ModpartyScraper(BaseScraper):
    BASE_URL = 'https://www.modparty.co.kr'
    SCHEDULE_URL = 'https://www.modparty.co.kr/single_party'

    REGION_KEYWORDS = ['강남', '홍대', '수원', '대전', '대구', '부산', '인천']
    DATE_PATTERN = re.compile(r'(\d{1,2})[월/.](\d{1,2})일?')
    PRICE_PATTERN = re.compile(r'([\d,]+)원')

    def __init__(self):
        super().__init__('modparty')

    def scrape(self) -> list[EventModel]:
        events = []
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

                soup_html = page.content()
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(soup_html, 'html.parser')

                post_links = []
                for a in soup.select('a[href*="bmode=view"]'):
                    href = a.get('href', '')
                    title = a.get_text(strip=True)
                    if title and ('소개팅' in title or '파티' in title):
                        full_url = href if href.startswith('http') else self.BASE_URL + href
                        post_links.append((title, full_url))

                self.logger.info(f'모드파티 게시물 {len(post_links)}개 발견')

                for title, url in post_links[:5]:
                    try:
                        page.goto(url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        content_text = page.inner_text('body')

                        thumbnail_url = None
                        imgs = page.eval_on_selector_all(
                            'img[src*="cdn.imweb"], img[src*="modparty"]',
                            'els => els.map(e => e.src)',
                        )
                        if imgs:
                            thumbnail_url = imgs[0]

                        parsed = self._parse_post(title, content_text, url, thumbnail_url)
                        events.extend(parsed)
                        time.sleep(1)
                    except Exception as e:
                        self.logger.warning(f'게시물 파싱 실패 {url}: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'모드파티 크롤링 실패: {e}')

        return events

    def _parse_post(
        self,
        post_title: str,
        content: str,
        source_url: str,
        thumbnail_url: Optional[str],
    ) -> list[EventModel]:
        events = []
        lines = [l.strip() for l in content.split('\n') if l.strip()]

        year_match = re.search(r'(\d{4})년', post_title + content)
        month_match = re.search(r'(\d{1,2})월', post_title)
        current_year = int(year_match.group(1)) if year_match else datetime.now().year
        current_month = int(month_match.group(1)) if month_match else datetime.now().month

        for i, line in enumerate(lines):
            date_match = self.DATE_PATTERN.search(line)
            if not date_match:
                continue

            try:
                m = int(date_match.group(1))
                d = int(date_match.group(2))
                if m < 1 or m > 12 or d < 1 or d > 31:
                    continue

                event_date = datetime(current_year, m, d, 14, 0)
                if event_date < datetime.now():
                    continue

                context_lines = lines[max(0, i - 1):i + 3]
                title_text = ' '.join(context_lines)[:100]
                title = sanitize_text(f'[모드파티] {title_text}', 80)

                price_text = ' '.join(lines[max(0, i - 2):i + 5])
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
