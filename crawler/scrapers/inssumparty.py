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


class InssumPartyScraper(BaseScraper):
    BASE_URL = 'https://www.inssumparty.co.kr'
    LIST_URL = 'https://www.inssumparty.co.kr/party'

    REGION_MAP = {
        '대전': '대전', '유성': '대전', '둔산': '대전',
        '서울': '서울', '강남': '강남', '홍대': '홍대',
        '수원': '수원', '부산': '부산',
    }

    # "3월 21일(토) 20:00" 패턴
    DATE_RE1 = re.compile(r'(\d{1,2})월\s*(\d{1,2})일[^,]*?(\d{1,2}):(\d{2})')
    # "3/21(토)" — 반드시 요일 표기 있어야 함
    DATE_RE2 = re.compile(r'(\d{1,2})/(\d{1,2})\s*[（(][월화수목금토일]')
    PRICE_RE = re.compile(r'([\d,]+)원')
    SEATS_RE = re.compile(r'남\s*(\d+)/(\d+).*?여\s*(\d+)/(\d+)')

    def __init__(self):
        super().__init__('inssumparty')

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

                # 리스팅 페이지
                page.goto(self.LIST_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(3)

                products = self._collect_products(page)
                self.logger.info(f'인썸파티 상품 {len(products)}개 발견')

                # 각 상품 페이지
                for idx, data in products.items():
                    try:
                        page.goto(data['url'], timeout=15000)
                        page.wait_for_load_state('domcontentloaded', timeout=8000)
                        time.sleep(2)

                        soup = BeautifulSoup(page.content(), 'html.parser')
                        new_events = self._parse_product(soup, idx, data)
                        events.extend(new_events)
                    except Exception as e:
                        self.logger.warning(f'인썸파티 idx={idx} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'인썸파티 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        self.logger.info(f'인썸파티 총 {len(unique)}개 이벤트')
        return unique

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

    def _parse_product(self, soup: BeautifulSoup, idx: str, listing: dict) -> list[EventModel]:
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

        # 가격
        prices = [int(m.group(1).replace(',', '')) for m in self.PRICE_RE.finditer(listing_text)
                  if int(m.group(1).replace(',', '')) >= 10000]
        prices = sorted(set(prices))
        price = prices[0] if prices else None

        # 지역
        region = '대전'  # 기본값 대전
        for kw, region_val in self.REGION_MAP.items():
            if kw in title_line or kw in listing_text:
                region = region_val
                break

        # 날짜+시간 파싱 (shop_view 상세 텍스트에서)
        seen_dates: set[str] = set()
        for line in text.split('\n'):
            line = line.strip()
            if not line or line.startswith('[옵션]'):
                continue

            # "🕛 3월 21일(토) 20:00-22:00" 패턴
            date_m = self.DATE_RE1.search(line)
            if date_m:
                mo, d = int(date_m.group(1)), int(date_m.group(2))
                hour, minute = int(date_m.group(3)), int(date_m.group(4))
            else:
                # "3/21(토)" 패턴 (시간 기본값)
                date_m2 = self.DATE_RE2.search(line)
                if not date_m2:
                    continue
                mo, d = int(date_m2.group(1)), int(date_m2.group(2))
                hour, minute = 20, 0  # 기본 20시

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

            # 마감 여부: 같은 라인 또는 다음 라인에 "남 N/N 여 N/N" 패턴
            context_block = line + ' ' + text[text.find(line):text.find(line)+200]
            seats_m = self.SEATS_RE.search(context_block)
            seats_left_male = None
            seats_left_female = None
            if seats_m:
                cur_m, cap_m = int(seats_m.group(1)), int(seats_m.group(2))
                cur_f, cap_f = int(seats_m.group(3)), int(seats_m.group(4))
                seats_left_male = cap_m - cur_m
                seats_left_female = cap_f - cur_f
                # 양쪽 마감이면 스킵
                if seats_left_male <= 0 and seats_left_female <= 0:
                    continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            theme = ['와인'] if '와인' in title_line else ['일반']
            source_url = f'{self.BASE_URL}/shop_view/?idx={idx}#evt={event_date.strftime("%Y%m%d%H%M")}'
            title = sanitize_text(f'[인썸파티] {title_line}', 80)

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=price,
                    price_female=price,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[],
                    theme=theme,
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                ))
            except Exception:
                continue

        return events
