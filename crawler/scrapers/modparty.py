"""모드파티 (modparty.co.kr) 스크래퍼 — imweb 쇼핑 기반, 로그인 필요"""
import os
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


class ModpartyScraper(BaseScraper):
    BASE_URL = 'https://www.modparty.co.kr'
    LOGIN_URL = 'https://www.modparty.co.kr/login'
    SHOP_LIST_URL = 'https://www.modparty.co.kr/?shop1=list'

    REGION_MAP = {
        '압구정': '강남', '청담': '강남', '역삼': '강남', '강남': '강남',
        '서울': '서울', '홍대': '홍대', '신촌': '신촌',
        '수원': '수원', '판교': '판교', '일산': '일산',
        '인천': '인천', '대전': '대전', '대구': '대구',
        '부산': '부산', '광주': '기타', '천안': '기타',
        '울산': '기타',
    }
    # N월 N일(요일) 패턴
    DATE_PATTERN = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    # 마감 여부 패턴
    CLOSED_PATTERN = re.compile(r'마감|SOLD')
    PRICE_PATTERN = re.compile(r'([\d,]+)원')
    SEATS_PATTERN = re.compile(r'남\s*(\d+)/(\d+).*?여\s*(\d+)/(\d+)')

    def __init__(self):
        super().__init__('modparty')
        self._uid = os.getenv('MODPARTY_ID', '')
        self._pw = os.getenv('MODPARTY_PW', '')

    def scrape(self) -> list[EventModel]:
        if not self._uid or not self._pw:
            self.logger.warning('MODPARTY_ID / MODPARTY_PW 환경변수 없음 — 스킵')
            return []

        events = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                )
                page = context.new_page()

                # ── 로그인 ──
                page.goto(self.LOGIN_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                page.fill('input[name="uid"]', self._uid)
                page.fill('input[name="passwd"]', self._pw)
                with page.expect_navigation(timeout=15000):
                    page.click('button:has-text("로그인")')

                if '/login' in page.url:
                    self.logger.error('모드파티 로그인 실패')
                    browser.close()
                    return []
                self.logger.info('모드파티 로그인 성공')

                # ── 상품 목록 ──
                page.goto(self.SHOP_LIST_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(2)

                soup = BeautifulSoup(page.content(), 'html.parser')
                product_data = self._collect_product_data(soup)

                # ── 각 상품 페이지에서 OG 이미지 수집 (로그인 세션 유지) ──
                for idx, data in product_data.items():
                    try:
                        page.goto(data['url'].split('#')[0], timeout=15000)
                        page.wait_for_load_state('domcontentloaded', timeout=8000)
                        detail_soup = BeautifulSoup(page.content(), 'html.parser')
                        og = detail_soup.find('meta', property='og:image')
                        if og and og.get('content') and 'placeholder' not in og['content']:
                            product_data[idx]['img'] = og['content']
                        else:
                            # OG 없으면 상품 이미지 직접 찾기
                            for img in detail_soup.select('img[src*="imweb"], img[src*="cdn"]'):
                                src = img.get('src', '')
                                if src and 'placeholder' not in src and not src.endswith('.gif'):
                                    product_data[idx]['img'] = src
                                    break
                    except Exception as e:
                        self.logger.warning(f'모드파티 상품 idx={idx} 이미지 수집 실패: {e}')

                events = self._parse_product_data(product_data)

                browser.close()
        except Exception as e:
            self.logger.error(f'모드파티 크롤링 실패: {e}')

        return events

    def _collect_product_data(self, soup: BeautifulSoup) -> dict[str, dict]:
        """상품 목록에서 idx별 데이터 수집 (이미지는 별도로 상세 페이지에서 가져옴)"""
        product_data: dict[str, dict] = {}

        for a in soup.select('a[href*="/shop_view/"]'):
            href = a.get('href', '')
            idx_match = re.search(r'idx=(\d+)', href)
            if not idx_match:
                continue
            idx = idx_match.group(1)
            full_url = self.BASE_URL + href
            text = a.get_text(separator='\n', strip=True)

            # 이미지 URL 추출 (a 태그 내부 또는 부모 컨테이너의 img)
            img_url = None
            img_tag = a.find('img')
            if not img_tag:
                parent = a.parent
                if parent:
                    img_tag = parent.find('img')
            if img_tag:
                src = img_tag.get('src') or img_tag.get('data-src') or img_tag.get('data-original', '')
                if src and not src.endswith('.gif') and 'icon' not in src.lower():
                    img_url = src if src.startswith('http') else self.BASE_URL + src

            if idx not in product_data:
                product_data[idx] = {'url': full_url, 'text': text, 'img': img_url}
            else:
                # 더 긴 텍스트(날짜 포함 버전) 우선
                if len(text) > len(product_data[idx]['text']):
                    product_data[idx]['text'] = text
                # 이미지는 처음 발견한 것 유지
                if not product_data[idx].get('img') and img_url:
                    product_data[idx]['img'] = img_url

        self.logger.info(f'모드파티 상품 {len(product_data)}개 발견')
        return product_data

    def _parse_product_data(self, product_data: dict[str, dict]) -> list[EventModel]:
        """수집된 product_data로 이벤트 목록 생성"""
        events = []
        seen_keys: set[str] = set()
        current_year = datetime.now().year

        for idx, data in product_data.items():
            url = data['url']
            text = data['text']
            img_url = data.get('img')
            lines = [l.strip() for l in text.split('\n') if l.strip()]

            # 제목: 첫 번째 유의미한 라인 (지역태그 제거)
            title_line = ''
            for line in lines:
                if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                    title_line = line
                    break

            # 지역 추출
            region = '서울'
            for keyword, region_val in self.REGION_MAP.items():
                if keyword in title_line or keyword in text:
                    region = region_val
                    break

            # 가격 추출 (첫 번째 1만원 이상 가격)
            price_raw = self.PRICE_PATTERN.search(text)
            price = None
            if price_raw:
                val = int(price_raw.group(1).replace(',', ''))
                if val >= 10000:
                    price = val

            # 날짜별 이벤트 생성
            for line in lines:
                date_m = self.DATE_PATTERN.search(line)
                if not date_m:
                    continue

                mo, d = int(date_m.group(1)), int(date_m.group(2))
                if not (1 <= mo <= 12 and 1 <= d <= 31):
                    continue

                # 마감 이벤트 스킵 (대기자만 가능한 건 제외)
                if '마감(대기자' in line:
                    continue

                try:
                    event_date = datetime(current_year, mo, d, 14, 0)
                    if event_date < datetime.now():
                        # 다음 해 시도
                        event_date = datetime(current_year + 1, mo, d, 14, 0)
                except ValueError:
                    continue

                # 잔여 좌석 파싱
                seats_m = self.SEATS_PATTERN.search(line)
                seats_left_male = None
                seats_left_female = None
                if seats_m:
                    cur_m, cap_m = int(seats_m.group(1)), int(seats_m.group(2))
                    cur_f, cap_f = int(seats_m.group(3)), int(seats_m.group(4))
                    seats_left_male = cap_m - cur_m
                    seats_left_female = cap_f - cur_f

                date_key = f'{idx}_{event_date.strftime("%Y%m%d")}'
                if date_key in seen_keys:
                    continue
                seen_keys.add(date_key)

                # 테마 분류
                theme = ['와인'] if '와인' in text else ['일반']
                if '요리' in text or '쿡' in text:
                    theme = ['쿠킹']

                unique_url = f'{url}#evt={event_date.strftime("%Y%m%d%H%M")}'
                title = sanitize_text(f'[모드파티] {title_line}', 80)

                try:
                    events.append(EventModel(
                        title=title,
                        event_date=event_date,
                        location_region=region,
                        location_detail=None,
                        price_male=price,
                        price_female=price,
                        gender_ratio=None,
                        source_url=unique_url,
                        thumbnail_urls=[img_url] if img_url else [],
                        theme=theme,
                        seats_left_male=seats_left_male,
                        seats_left_female=seats_left_female,
                    ))
                except Exception:
                    continue

        return events
