"""감정적인 오렌지들 (emotional0ranges.com) 스크래퍼 — imweb 기반, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


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
    }

    # "N월 N일" 패턴 (리뷰 제외: [옵션] 으로 시작하는 라인은 과거 리뷰)
    DATE_RE = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    TIME_RE = re.compile(r'(오전|오후|저녁|낮|새벽)\s*(\d{1,2})시(?:\s*(\d{2})분)?')
    PRICE_RE = re.compile(r'([\d,]+)원')

    def __init__(self):
        super().__init__('emotional-orange')

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

                # 1. /date 페이지에서 상품 목록 수집
                page.goto(self.DATE_PAGE_URL, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                time.sleep(2)

                products = self._collect_products(page)
                self.logger.info(f'감정오렌지 상품 {len(products)}개 발견')

                # 2. 각 상품 페이지에서 날짜 추출
                for idx, data in products.items():
                    try:
                        page.goto(data['url'], timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        time.sleep(1.5)

                        soup = BeautifulSoup(page.content(), 'html.parser')
                        new_events = self._parse_product_page(soup, idx, data)
                        events.extend(new_events)
                    except Exception as e:
                        self.logger.warning(f'감정오렌지 상품 idx={idx} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'감정오렌지 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        self.logger.info(f'감정오렌지 총 {len(unique)}개 이벤트')
        return unique

    def _collect_products(self, page) -> dict[str, dict]:
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

    def _parse_product_page(self, soup: BeautifulSoup, idx: str, listing_data: dict) -> list[EventModel]:
        events: list[EventModel] = []
        text = soup.get_text(separator='\n', strip=True)
        listing_text = listing_data.get('text', '')
        current_year = datetime.now().year
        now = datetime.now()

        # 썸네일: OG 이미지 또는 첫 번째 상품 이미지
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

        # 제목: 리스팅 텍스트 첫 줄
        title_line = ''
        for line in listing_text.split('\n'):
            line = line.strip()
            if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                title_line = line
                break

        # 가격 추출 (리스팅 텍스트에서)
        prices = []
        for m in self.PRICE_RE.finditer(listing_text):
            val = int(m.group(1).replace(',', ''))
            if val >= 10000:
                prices.append(val)
        prices = sorted(set(prices))
        price_male = prices[0] if prices else None
        price_female = prices[1] if len(prices) > 1 else price_male

        # 지역 추출 (제목에서 [ ] 안 내용)
        region = '서울'
        bracket_m = re.search(r'\[([^\]]+)\]', title_line)
        if bracket_m:
            bracket_text = bracket_m.group(1)
            for kw, region_val in self.REGION_MAP.items():
                if kw in bracket_text:
                    region = region_val
                    break

        # 날짜 추출: [옵션] 없는 라인에서 미래 날짜만
        seen_dates: set[str] = set()
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

            # 시간 추출
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
                # 너무 먼 미래(1년 초과)는 스킵
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 테마
            theme = ['일반']
            if '와인' in title_line or '와인' in line:
                theme = ['와인']
            elif '쿠킹' in title_line or '요리' in title_line:
                theme = ['쿠킹']

            source_url = f'{self.BASE_URL}/shop_view/?idx={idx}#evt={event_date.strftime("%Y%m%d%H%M")}'
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
                    seats_left_male=None,
                    seats_left_female=None,
                ))
            except Exception:
                continue

        return events
