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
from utils.date_filter import is_within_one_month


class ModpartyScraper(BaseScraper):
    BASE_URL = 'https://www.modparty.co.kr'
    LOGIN_URL = 'https://www.modparty.co.kr/login'
    SHOP_LIST_URL = 'https://www.modparty.co.kr/?shop1=list'

    # 모드파티 실시간 예약 위젯 Supabase API (공개 anon key)
    SUPABASE_URL = 'https://lqxfkqxrtjnqozqmwzlp.supabase.co'
    SUPABASE_ANON_KEY = (
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
        '.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxeGZrcXhydGpucW96cW13emxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzODkyNzcsImV4cCI6MjA4MTk2NTI3N30'
        '.RxkECT5bbIaW9tJdYff6T3tQi0R4Asx637RuViGbEpQ'
    )

    REGION_MAP = {
        '압구정': '강남', '청담': '강남', '역삼': '강남', '강남': '강남',
        '이태원': '서울', '서울': '서울', '홍대': '홍대', '신촌': '신촌',
        '수원': '수원', '판교': '판교', '일산': '일산',
        '인천': '인천', '대전': '대전', '대구': '대구',
        '부산': '부산', '광주': '기타', '천안': '기타',
        '울산': '기타',
    }

    # 나이대 매핑: 제목에 포함된 키워드 → (min_age, max_age, label)
    AGE_GROUP_MAP = {
        '2030': (20, 39, '20-30대'),
        '3040': (30, 49, '30-40대'),
        '2040': (20, 49, '20-40대'),
        '2025': (20, 34, '20대-30대초반'),
        '3035': (30, 39, '30대'),
    }

    # N월 N일(요일) 패턴
    DATE_PATTERN = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    # 마감 여부 패턴
    CLOSED_PATTERN = re.compile(r'마감|SOLD')
    PRICE_PATTERN = re.compile(r'([\d,]+)원')
    # 좌석 패턴: "남 16/20 여 17/20" 형식 (현재참가/정원)
    SEATS_PATTERN = re.compile(r'남\s*(\d+)/(\d+).*?여\s*(\d+)/(\d+)')

    def __init__(self):
        super().__init__('modparty')
        self._uid = os.getenv('MODPARTY_ID', '')
        self._pw = os.getenv('MODPARTY_PW', '')
        self._booking_counts: dict[str, dict] = {}  # {prod_no: {date_code: row}}

    def scrape(self) -> list[EventModel]:
        if not self._uid or not self._pw:
            self.logger.warning('MODPARTY_ID / MODPARTY_PW 환경변수 없음 — 스킵')
            return []

        events = []
        try:
            # ── Supabase API로 예약 현황 사전 수집 ──
            self._fetch_booking_counts()

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
                time.sleep(3)  # 위젯 로드 대기

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

        return events  # 날짜 필터는 _parse_product_data 내부에서 적용됨

    def _fetch_booking_counts(self) -> None:
        """Supabase REST API로 booking_counts 테이블 전체 조회 (공개 anon key 사용)"""
        try:
            import urllib.request
            import json

            url = (
                f'{self.SUPABASE_URL}/rest/v1/booking_counts'
                '?select=prod_no,date_code,date_label,male_count,female_count,max_capacity'
                '&order=updated_at.desc&limit=500'
            )
            req = urllib.request.Request(url, headers={
                'apikey': self.SUPABASE_ANON_KEY,
                'Authorization': f'Bearer {self.SUPABASE_ANON_KEY}',
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                rows = json.loads(resp.read().decode())

            # {prod_no_str: {date_code: row}} 형태로 인덱싱
            self._booking_counts = {}
            for row in rows:
                prod_key = str(row['prod_no'])
                date_key = row['date_code']
                if prod_key not in self._booking_counts:
                    self._booking_counts[prod_key] = {}
                self._booking_counts[prod_key][date_key] = row

            self.logger.info(f'모드파티 booking_counts {len(rows)}개 로드')
        except Exception as e:
            self.logger.warning(f'모드파티 Supabase API 실패 (fallback HTML 사용): {e}')
            self._booking_counts = {}

    def _parse_age_group(self, text: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
        """제목/텍스트에서 나이대 파싱. (min_age, max_age, label) 반환"""
        for keyword, (min_age, max_age, label) in self.AGE_GROUP_MAP.items():
            if keyword in text:
                return min_age, max_age, label
        return None, None, None

    def _get_booking_for_date(self, idx: str, date_code: str) -> Optional[dict]:
        """특정 상품+날짜의 booking_counts 행 반환"""
        prod_data = self._booking_counts.get(idx, {})
        return prod_data.get(date_code)

    def _date_to_code(self, month: int, day: int) -> str:
        """날짜를 booking_counts date_code 형식(MMDD)으로 변환"""
        return f'{month:02d}{day:02d}'

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

        # ── booking-date-config 요소 파싱 (HTML에 임베드된 예약 현황) ──
        # 형식: <div class="booking-date-config" data-date="MMDD"
        #             data-male="N" data-female="N" data-product-id="IDX">
        for config in soup.select('.booking-date-config'):
            prod_id = config.get('data-product-id', '')
            date_code = config.get('data-date', '')
            male_cnt = config.get('data-male', '')
            female_cnt = config.get('data-female', '')
            if prod_id and date_code:
                prod_key = str(prod_id)
                if prod_key not in self._booking_counts:
                    self._booking_counts[prod_key] = {}
                # HTML 값으로 보완 (Supabase에 없는 경우에만)
                if date_code not in self._booking_counts[prod_key]:
                    self._booking_counts[prod_key][date_code] = {
                        'prod_no': prod_id,
                        'date_code': date_code,
                        'male_count': int(male_cnt) if male_cnt.isdigit() else 0,
                        'female_count': int(female_cnt) if female_cnt.isdigit() else 0,
                        'max_capacity': None,
                    }

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

            # 나이대 추출 — 제목에서 "2030", "3040" 키워드 파싱
            age_min, age_max, age_label = self._parse_age_group(title_line + ' ' + text)

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

                # 잔여 좌석 파싱 (HTML 텍스트에서: "남 16/20 여 17/20")
                seats_m = self.SEATS_PATTERN.search(line)
                seats_left_male = None
                seats_left_female = None
                capacity_male = None
                capacity_female = None

                if seats_m:
                    cur_m, cap_m = int(seats_m.group(1)), int(seats_m.group(2))
                    cur_f, cap_f = int(seats_m.group(3)), int(seats_m.group(4))
                    seats_left_male = cap_m - cur_m
                    seats_left_female = cap_f - cur_f
                    capacity_male = cap_m
                    capacity_female = cap_f

                # Supabase booking_counts에서 더 정확한 데이터 보완
                date_code = self._date_to_code(mo, d)
                booking_row = self._get_booking_for_date(idx, date_code)
                participant_stats = None

                if booking_row:
                    bc_male = booking_row.get('male_count', 0) or 0
                    bc_female = booking_row.get('female_count', 0) or 0
                    bc_max = booking_row.get('max_capacity') or None
                    date_label = booking_row.get('date_label', '')

                    # booking_counts가 더 정확 (Supabase 실시간 데이터 우선)
                    if bc_max:
                        capacity_male = bc_max
                        capacity_female = bc_max
                        seats_left_male = bc_max - bc_male
                        seats_left_female = bc_max - bc_female

                    participant_stats = {
                        'male_count': bc_male,
                        'female_count': bc_female,
                        'max_capacity': bc_max,
                        'date_label': date_label,
                        'source': 'supabase_booking_counts',
                    }

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
                        capacity_male=capacity_male,
                        capacity_female=capacity_female,
                        age_range_min=age_min,
                        age_range_max=age_max,
                        age_group_label=age_label,
                        participant_stats=participant_stats,
                    ))
                except Exception:
                    continue

        age_count = sum(1 for e in events if e.age_range_min is not None)
        stats_count = sum(1 for e in events if e.participant_stats is not None)
        filtered = []
        for ev in events:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(
            f'모드파티 이벤트 {len(filtered)}개 생성 (필터 전: {len(events)}개) '
            f'(나이대 {age_count}개, 참가자현황 {stats_count}개)'
        )
        return filtered
