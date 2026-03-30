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
from utils.date_filter import is_within_one_month

# 나이대 패턴 (우선순위 순):
#   "(91~04년)", "(91 - 04년)"             → 시작-끝년 범위, 마지막에만 년
#   "(92년 - 07년)", "(95년~02년)"          → 각각 년 붙는 형식
AGE_YEAR_RANGE_RE = re.compile(
    r'\(?\s*(\d{2,4})\s*년?\s*[-~～]\s*(\d{2,4})\s*년\s*\)?'
)
# 년생 범위: "95년생 ~ 02년생", "91년생~04년생"
AGE_BIRTH_RANGE_RE = re.compile(
    r'(\d{2,4})\s*년생\s*[-~～]\s*(\d{2,4})\s*년생'
)
# 나이 직접 표시: "28세~40세", "28~40세"
AGE_SE_RANGE_RE = re.compile(r'(\d{2})\s*[-~～]\s*(\d{2})\s*세')


def _year_to_age(yy: int, current_year: int = 2026) -> int:
    """두 자리/네 자리 년도 → 한국 나이 변환"""
    if yy < 100:
        year = (2000 + yy) if yy <= 25 else (1900 + yy)
    else:
        year = yy
    return current_year - year + 1


def _parse_age_range_from_text(text: str) -> tuple[Optional[int], Optional[int]]:
    """텍스트에서 나이대 최소/최대 추출. 년생 기반 또는 세 기반."""
    current_year = datetime.now().year

    # 우선: "95년생 ~ 02년생" 형식
    m = AGE_BIRTH_RANGE_RE.search(text)
    if m:
        y1 = int(m.group(1))
        y2 = int(m.group(2))
        age1 = _year_to_age(y1, current_year)
        age2 = _year_to_age(y2, current_year)
        return (min(age1, age2), max(age1, age2))

    # "(91~04년)", "(92년 - 07년)" 형식
    m = AGE_YEAR_RANGE_RE.search(text)
    if m:
        y1 = int(m.group(1))
        y2 = int(m.group(2))
        age1 = _year_to_age(y1, current_year)
        age2 = _year_to_age(y2, current_year)
        return (min(age1, age2), max(age1, age2))

    # "28~40세" 형식
    m = AGE_SE_RANGE_RE.search(text)
    if m:
        return (int(m.group(1)), int(m.group(2)))

    return (None, None)


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

                        # 나이대 추출: 상품명 + 상세 페이지 텍스트에서
                        detail_text = detail_soup.get_text(separator=' ', strip=True)
                        age_min, age_max = _parse_age_range_from_text(title_raw)
                        if age_min is None:
                            age_min, age_max = _parse_age_range_from_text(detail_text[:2000])

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
                                age_range_min=age_min,
                                age_range_max=age_max,
                            ))

                    except Exception as e:
                        self.logger.warning(f'러브매칭 상품 idx={idx} 실패: {e}')

                browser.close()

        except Exception as e:
            self.logger.error(f'러브매칭 크롤링 실패: {e}')

        filtered = []
        for ev in events:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'러브매칭 총 {len(filtered)}개 이벤트 (필터 전: {len(events)}개)')
        return filtered

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

    # ------------------------------------------------------------------ #
    # 테스트 가능한 파싱 헬퍼 메서드
    # ------------------------------------------------------------------ #

    def _parse_date(self, text: str) -> Optional[datetime]:
        """날짜 문자열을 datetime으로 변환. 실패 시 None 반환."""
        formats = [
            '%Y.%m.%d %H:%M',
            '%Y-%m-%d %H:%M',
            '%Y.%m.%d',
            '%Y-%m-%d',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(text.strip(), fmt)
            except ValueError:
                continue
        return None

    def _extract_region(self, text: str) -> str:
        """텍스트에서 지역 키워드를 찾아 반환. 없으면 '기타'."""
        for keyword, region in self.REGION_MAP.items():
            if keyword in text:
                return region
        return '기타'

    def _extract_price(self, text: str) -> Optional[int]:
        """텍스트에서 가격(원)을 추출. 없으면 None."""
        m = self.PRICE_PATTERN.search(text)
        if m:
            return int(m.group(1).replace(',', ''))
        return None

    def _extract_theme(self, text: str) -> list[str]:
        """텍스트에서 테마 키워드를 추출."""
        if '와인' in text:
            return ['와인']
        elif '커피' in text:
            return ['커피']
        elif '영화' in text:
            return ['전시']
        return ['일반']

    def _extract_ratio(self, text: str) -> Optional[str]:
        """텍스트에서 성비(예: 8:8)를 추출. 없으면 None."""
        m = re.search(r'(\d+:\d+)', text)
        if m:
            return m.group(1)
        return None

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
