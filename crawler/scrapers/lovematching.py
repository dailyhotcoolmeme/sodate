"""러브매칭 (lovematching.kr) 스크래퍼 — imweb 쇼핑 기반, 매주 정기 진행"""
import re
import time
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


class LoveMatchingScraper(BaseScraper):
    BASE_URL = 'https://lovematching.kr'
    SHOP_URL = 'https://lovematching.kr/shop'

    # 각 상품의 진행 요일 (0=월, 5=토, 6=일)
    PRODUCT_CONFIG = {
        '17': {'region': '강남', 'weekdays': [5, 6], 'time': (19, 0)},   # 강남 (역삼) 토·일
        '18': {'region': '을지로', 'weekdays': [3, 4], 'time': (19, 0)}, # 을지로 목·금
        '23': {'region': '신촌', 'weekdays': [5, 6], 'time': (19, 0)},   # 신촌 토·일
        '24': {'region': '신촌', 'weekdays': [5, 6], 'time': (18, 0)},   # 솔로파티 신촌
        '25': {'region': '성수', 'weekdays': [5, 6], 'time': (15, 0)},   # 영화미팅 성수
        '26': {'region': '신촌', 'weekdays': [5, 6], 'time': (19, 0)},   # 솔로파티 신촌
    }

    PRICE_PATTERN = re.compile(r'([\d,]+)원')
    REGION_MAP = {
        '강남': '강남', '역삼': '강남', '선릉': '강남',
        '을지로': '을지로', '신촌': '신촌', '성수': '성수',
        '홍대': '홍대', '이태원': '서울',
    }

    def __init__(self):
        super().__init__('lovematching')

    def scrape(self) -> list[EventModel]:
        events = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                )
                page = context.new_page()

                # 상품 목록
                page.goto(self.SHOP_URL, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                time.sleep(2)

                soup = BeautifulSoup(page.content(), 'html.parser')
                products = self._collect_products(soup)
                self.logger.info(f'러브매칭 상품 {len(products)}개 발견')

                # 각 상품 상세 페이지에서 이미지 + 정보 수집
                for idx, data in products.items():
                    try:
                        detail_url = f'{self.BASE_URL}/shop/?idx={idx}'
                        page.goto(detail_url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        time.sleep(1)

                        detail_soup = BeautifulSoup(page.content(), 'html.parser')

                        # OG 이미지 추출
                        og = detail_soup.find('meta', property='og:image')
                        img_url = og.get('content') if og and og.get('content') else data.get('img')

                        # 상품 텍스트에서 가격 추출
                        text = data.get('text', '')
                        prices = [int(m.group(1).replace(',', '')) for m in self.PRICE_PATTERN.finditer(text)
                                  if int(m.group(1).replace(',', '')) >= 10000]
                        price = prices[0] if prices else None

                        # 상품명 정리
                        title_raw = re.sub(r'[\d,]+원', '', text).strip()
                        title_raw = re.sub(r'\s+', ' ', title_raw).strip()

                        # 지역 추출
                        region = '서울'
                        cfg = self.PRODUCT_CONFIG.get(idx, {})
                        if cfg.get('region'):
                            region = cfg['region']
                        else:
                            for keyword, r in self.REGION_MAP.items():
                                if keyword in title_raw:
                                    region = r
                                    break

                        # 테마 추출
                        theme = ['일반']
                        if '와인' in title_raw:
                            theme = ['와인']
                        elif '커피' in title_raw:
                            theme = ['커피']
                        elif '영화' in title_raw:
                            theme = ['전시']

                        # 진행 요일 기반 다음 날짜 3개 생성
                        weekdays = cfg.get('weekdays', [5, 6])
                        hour, minute = cfg.get('time', (19, 0))
                        upcoming_dates = self._next_dates(weekdays, hour, minute, count=3)

                        for event_date in upcoming_dates:
                            title = sanitize_text(f'[러브매칭] {title_raw}', 80)
                            events.append(EventModel(
                                title=title,
                                event_date=event_date,
                                location_region=region,
                                location_detail=None,
                                price_male=price,
                                price_female=price,
                                gender_ratio=None,
                                source_url=f'{detail_url}#evt={event_date.strftime("%Y%m%d%H%M")}',
                                thumbnail_urls=[img_url] if img_url else [],
                                theme=theme,
                                seats_left_male=None,
                                seats_left_female=None,
                            ))

                    except Exception as e:
                        self.logger.warning(f'러브매칭 상품 idx={idx} 실패: {e}')

                browser.close()

        except Exception as e:
            self.logger.error(f'러브매칭 크롤링 실패: {e}')

        self.logger.info(f'러브매칭 총 {len(events)}개 이벤트')
        return events

    def _collect_products(self, soup: BeautifulSoup) -> dict[str, dict]:
        """상품 목록 수집 — /shop 페이지"""
        products = {}
        seen = set()
        for a in soup.select('a[href*="shop_view"], a[href*="/shop/?idx"]'):
            href = a.get('href', '')
            idx_m = re.search(r'idx=(\d+)', href)
            if not idx_m:
                continue
            idx = idx_m.group(1)
            if idx in seen or idx == '16':  # 온라인 소개팅 제외
                continue
            seen.add(idx)

            text = a.get_text(separator=' ', strip=True)
            img = a.find('img')
            img_url = img.get('src', '') if img else ''
            if img_url and not img_url.startswith('http'):
                img_url = urljoin(self.BASE_URL, img_url)

            products[idx] = {'text': text, 'img': img_url}
        return products

    def _next_dates(self, weekdays: list[int], hour: int, minute: int, count: int) -> list[datetime]:
        """지정 요일 기준 다음 날짜 N개 반환"""
        dates = []
        now = datetime.now()
        current = now
        while len(dates) < count:
            if current.weekday() in weekdays and current > now:
                dates.append(current.replace(hour=hour, minute=minute, second=0, microsecond=0))
            current += timedelta(days=1)
            if (current - now).days > 30:  # 30일 이내만
                break
        return dates
