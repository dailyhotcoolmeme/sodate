"""모드파티 (modparty.co.kr) 스크래퍼 — imweb 쇼핑 기반, 로그인 필요"""
import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, extract_description_from_soup
from utils.date_filter import is_within_one_month
from utils.region import resolve_region


class ModpartyScraper(BaseScraper):
    # 업체 공식 소스(임베드 JSON)에서 가격을 정확히 뽑으므로 크롤러가 가격을 채운다.
    WRITES_PRICE = True
    # booking_counts로 전체 일정을 안정적으로 뽑으므로, 사라진 옛 회차는 자동 삭제한다.
    DELETE_STALE = True
    # 상품 페이지의 '남 X/Y 여 X/Y'를 날짜별로 파싱해 좌석/품절을 채운다.
    WRITES_SEATS = True

    BASE_URL = 'https://www.modparty.co.kr'
    LOGIN_URL = 'https://www.modparty.co.kr/login'
    SHOP_LIST_URL = 'https://www.modparty.co.kr/?shop1=list'
    SINGLE_URL = 'https://www.modparty.co.kr/single_party'

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
                # 'load' 이벤트가 느려 타임아웃 나는 경우가 있어 domcontentloaded + 여유 + 예외 허용.
                # 네비게이션 이벤트를 못 잡아도 아래 URL 검사로 로그인 성공 여부 확인.
                try:
                    with page.expect_navigation(timeout=30000, wait_until='domcontentloaded'):
                        page.click('button:has-text("로그인")')
                except Exception:
                    page.wait_for_timeout(3000)

                if '/login' in page.url:
                    # 로그인 실패해도 상품목록·booking_counts는 공개라 계속 진행(경고만)
                    self.logger.warning('모드파티 로그인 실패 — 공개 소스로 계속 진행')
                else:
                    self.logger.info('모드파티 로그인 성공')

                # ── 상품 목록(싱글 메뉴 + 쇼핑 리스트) 수집 ──
                product_data: dict[str, dict] = {}
                for list_url in (self.SINGLE_URL, self.SHOP_LIST_URL):
                    try:
                        page.goto(list_url, timeout=20000)
                        page.wait_for_load_state('domcontentloaded', timeout=10000)
                        time.sleep(3)  # 위젯 로드 대기
                        self._collect_product_data(BeautifulSoup(page.content(), 'html.parser'), product_data)
                    except Exception as e:
                        self.logger.warning(f'모드파티 목록 수집 실패({list_url}): {e}')

                # ── 대상 상품 = 목록에 걸린 전체 상품 ──
                # ⚠️(2026-08-13) 예전엔 "booking_counts(모드파티 자체 Supabase)에 예약이
                #    있는 상품만" 걸렀는데, 그 Supabase 프로젝트가 통째로 사라져
                #    (lqxfkqxrtjnqozqmwzlp.supabase.co, 공개 DNS에서도 NXDOMAIN 확인 —
                #    실시간 위젯 스크립트까지 그 도메인에서 받아오다 보니 위젯 자체가
                #    브라우저에서도 로드 실패, HTML 폴백인 booking-date-config 도 같이
                #    무력화됐다) future_prods 가 매번 0개로 집계돼 9일간 크롤이 통째로
                #    비었다. 사전 필터를 걸 다른 안전한 방법이 없어, 목록에 걸린 상품은
                #    전부 상세페이지까지 열어 보고(_enrich_from_detail 이 본문에서 직접
                #    날짜·좌석을 뽑는다) 실제로 한 달 내 일정이 있는지는 _build_events
                #    에서 판정한다. 상품 수만큼 상세 조회가 늘어 크롤 시간이 길어지지만,
                #    "일정이 전부 안 보이는 것"보다는 낫다.
                future_prods = set(product_data.keys()) | self._future_booking_prods()
                self.logger.info(f'모드파티 대상 상품 {len(future_prods)}개 (목록 전체)')

                # ── 대상 상품 상세페이지에서 제목/이미지/본문/가격 보강 ──
                for idx in future_prods:
                    data = product_data.get(idx)
                    if not data:
                        continue
                    try:
                        detail_url = data['url'].split('#')[0]
                        # 제목·이미지·본문·날짜별 좌석은 전부 서버가 완성해서 내려주는
                        # 정적 HTML이라 JS 실행이 필요 없다(2026-08-13 실측 — 순수 HTTP
                        # 로는 idx=248의 두 날짜가 항상 다 나오는데, Playwright 렌더는
                        # 죽은 실시간 위젯 스크립트가 계속 재시도하는 여파로 렌더가 밀려
                        # 대기시간(2500~6000ms)에 따라 날짜가 들쭉날쭉 잡혔다). 순수
                        # httpx 로 안정적으로 받는다. 페이지 이동 자체는 아래 성별
                        # 가격 조회(_extract_gender_prices)가 같은 세션 컨텍스트에서
                        # /shop/load_option.cm 을 상대경로로 호출하므로 그대로 둔다.
                        try:
                            detail_html = httpx.get(
                                detail_url, timeout=15, verify=False, follow_redirects=True,
                                headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'},
                            ).text
                        except Exception:
                            detail_html = None
                        page.goto(detail_url, timeout=15000)
                        page.wait_for_load_state('domcontentloaded', timeout=8000)
                        page.wait_for_timeout(1500)
                        self._enrich_from_detail(
                            data, BeautifulSoup(detail_html or page.content(), 'html.parser')
                        )
                        # 성별 실가격+매진: 예약위젯 옵션 AJAX(매진=대기신청도 가격 있음)
                        gp = self._extract_gender_prices(page, idx)
                        if gp.get('남성'):
                            data['price_male'], data['male_sold'] = gp['남성']
                        if gp.get('여성'):
                            data['price_female'], data['female_sold'] = gp['여성']
                    except Exception as e:
                        self.logger.warning(f'모드파티 상품 idx={idx} 상세 수집 실패: {e}')

                events = self._build_events(product_data, future_prods)

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

    def _extract_description(self, soup: BeautifulSoup) -> Optional[str]:
        """상품 상세 페이지 본문 텍스트 추출 (해시태그 키워드 확보용).

        imweb 상품 상세 본문 영역을 우선 시도하고, 없으면 og:description 메타 사용.
        네비/푸터 보일러플레이트는 본문 영역 선택자로 배제한다.
        """
        # imweb .detail_detail_wrap 등 컨테이너 + og + 본문 폴백을 공용 추출기로 처리
        return extract_description_from_soup(soup, 6000)

    # 제목의 지명 키워드 → 표준 지역 (모드파티 제목엔 지역이 확실히 들어있음)
    _TITLE_REGION_GROUPS = [
        (('압구정', '청담', '역삼', '신사', '논현', '삼성', '강남'), '강남'),
        (('인천',), '인천'),
        (('수원',), '수원'),
        (('해운대', '부산'), '부산'),
        (('동성로', '대구'), '대구'),
        (('대전',), '대전'),
        (('광주',), '광주'),
        (('쌍용동', '천안'), '천안'),
        (('일산',), '일산'),
        (('홍대',), '홍대'),
        (('서울',), '서울'),
    ]

    def _region_from_title(self, title: str) -> Optional[str]:
        for kws, reg in self._TITLE_REGION_GROUPS:
            if any(k in title for k in kws):
                return reg
        return None

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

    def _collect_product_data(self, soup: BeautifulSoup, product_data: dict[str, dict] | None = None) -> dict[str, dict]:
        """상품 목록에서 idx별 데이터 수집. product_data 를 주면 병합(여러 목록 페이지 누적)."""
        if product_data is None:
            product_data = {}

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

    # 나이 OCR 워커(Cloudflare Workers AI + KV 캐시). 이미지당 1회만 AI 실행.
    OCR_WORKER_URL = 'https://sodate-ocr.dailyhotcoolmeme.workers.dev/'
    _WD = ['월', '화', '수', '목', '금', '토', '일']
    _TIME_SEG = re.compile(r'(?:\(([월화수목금토일,\s]+)\))?\s*(\d{1,2}):(\d{2})')
    _BIRTH_RE = re.compile(r'(\d{2})\s*[~\-∼]\s*(\d{2})')

    def _fetch_age(self, img_url: str) -> Optional[dict]:
        """OCR 워커로 이미지에서 남/여 년생 추출. {male,female} 반환(실패 시 None)."""
        import urllib.request as _u, urllib.parse as _up, json as _json
        try:
            url = self.OCR_WORKER_URL + '?img=' + _up.quote(img_url, safe='')
            # UA 없으면 Cloudflare가 봇으로 403 처리 → 브라우저 UA 필수
            req = _u.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36'})
            with _u.urlopen(req, timeout=40) as r:
                d = _json.loads(r.read().decode())
            if d.get('male') or d.get('female'):
                return d
        except Exception as e:
            self.logger.warning(f'나이 OCR 실패({img_url[:60]}): {e}')
        return None

    def _yy_to_year(self, yy: int) -> int:
        return 2000 + yy if yy <= 20 else 1900 + yy

    def _age_str_from_birth(self, birth_str: Optional[str]) -> tuple[Optional[str], Optional[int], Optional[int]]:
        """'90~00년생' → 만나이 문자열 '26~36'과 (age_lo, age_hi). 필터·표시는 만나이 기준(오너 표준)."""
        m = self._BIRTH_RE.search(birth_str or '')
        if not m:
            return None, None, None
        y1 = self._yy_to_year(int(m.group(1)))
        y2 = self._yy_to_year(int(m.group(2)))
        now_year = datetime.now().year
        a_lo = now_year - max(y1, y2)   # 늦게 태어날수록 어림 = 낮은 나이
        a_hi = now_year - min(y1, y2)
        return f'{a_lo}~{a_hi}', a_lo, a_hi

    def _age_range_from_birth(self, *birth_strs: Optional[str]) -> tuple[Optional[int], Optional[int]]:
        """'90~00년생' 류 문자열들 → 나이 범위(min,max). 현재연도 기준."""
        now_year = datetime.now().year
        births = []
        for s in birth_strs:
            m = self._BIRTH_RE.search(s or '')
            if not m:
                continue
            ya = self._yy_to_year(int(m.group(1)))
            yb = self._yy_to_year(int(m.group(2)))
            births += [ya, yb]
        if not births:
            return None, None
        return now_year - max(births), now_year - min(births)

    def _time_for_date(self, time_text: Optional[str], dt: datetime) -> Optional[tuple[int, int]]:
        """요일별 시간 문구에서 해당 날짜 요일의 시작시각 (hh,mm) 반환."""
        if not time_text:
            return None
        wd = self._WD[dt.weekday()]
        fallback = None
        for seg in re.split(r'/', time_text):
            m = self._TIME_SEG.search(seg)
            if not m:
                continue
            hh, mm = int(m.group(2)), int(m.group(3))
            if not (0 <= hh <= 23 and 0 <= mm <= 59):
                continue
            if fallback is None:
                fallback = (hh, mm)
            days = m.group(1)
            if days is None:          # 요일 표기 없음 → 전체 적용
                return (hh, mm)
            if wd in days:            # 이 날짜 요일 매칭
                return (hh, mm)
        return fallback

    def _future_booking_prods(self) -> set[str]:
        """booking_counts 에서 한 달 내 일정이 하나라도 있는 상품 idx 집합"""
        prods: set[str] = set()
        for idx, dates in self._booking_counts.items():
            for dc in dates:
                dt = self._parse_date_code(dc)
                if dt and is_within_one_month(dt):
                    prods.add(idx)
                    break
        return prods

    def _parse_date_code(self, dc: str) -> Optional[datetime]:
        """booking_counts date_code(MMDD 또는 M/D)를 이벤트 날짜로 변환. 지난 날짜는 내년으로."""
        dc = (dc or '').strip()
        m = re.match(r'^(\d{1,2})/(\d{1,2})$', dc)
        if m:
            mo, d = int(m.group(1)), int(m.group(2))
        else:
            m = re.fullmatch(r'(\d{2})(\d{2})', dc)
            if not m:
                return None
            mo, d = int(m.group(1)), int(m.group(2))
        if not (1 <= mo <= 12 and 1 <= d <= 31):
            return None
        now = datetime.now()
        try:
            dt = datetime(now.year, mo, d, 14, 0)
        except ValueError:
            return None
        if dt < now - timedelta(days=1):
            try:
                dt = datetime(now.year + 1, mo, d, 14, 0)
            except ValueError:
                return None
        return dt

    # imweb 예약위젯 옵션 AJAX(load_option.cm)를 페이지 세션으로 재현. 클릭보다 안정적·결정적.
    _OPT_FETCH_JS = """async (body) => {
      const r = await fetch('/shop/load_option.cm', {method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
        body});
      return await r.text();
    }"""

    def _load_option_html(self, page, idx: str, sels: list) -> str:
        import json as _json
        body = f'type=prod&prod_idx={idx}'
        for i, (oc, vc, vn) in enumerate(sels):
            body += (f'&selected_require_options[{i}][value_type]=SELECT'
                     f'&selected_require_options[{i}][option_code]={oc}'
                     f'&selected_require_options[{i}][value_code]={vc}'
                     f'&selected_require_options[{i}][value_name]={vn}')
        r = page.evaluate(self._OPT_FETCH_JS, body)
        try:
            return _json.loads(r).get('option_html', '') or ''
        except Exception:
            return r or ''

    def _extract_gender_prices(self, page, idx: str) -> dict:
        """예약위젯 옵션 AJAX 3단계(날짜→성별→성별선택)로 남/여 가격+매진(대기신청) 추출.
        매진이어도 옵션은 '남성(대기신청) 79,000원' 형태로 살아있음 → 가격 확보 가능.
        반환: {'남성': (price, soldout), '여성': (price, soldout)}"""
        out: dict = {}
        try:
            h1 = self._load_option_html(page, idx, [])
            oc1_m = re.search(r'_form_select_wrap_(O[0-9a-f]+)', h1)
            dates = re.findall(r"'(O[0-9a-f]{10,})',\s*'([^']*?\d+월\d+일[^']*)'", h1)
            if not (oc1_m and dates):
                return out
            oc1 = oc1_m.group(1)
            for vc, vn in dates[:4]:
                if '남성' in out and '여성' in out:
                    break
                h2 = self._load_option_html(page, idx, [(oc1, vc, vn)])
                oc2 = None
                for m in re.finditer(r'_form_select_wrap_(O[0-9a-f]+)', h2):
                    if m.group(1) != oc1:
                        oc2 = m.group(1)
                        break
                if not oc2:
                    continue
                # '남성' 또는 '남성(대기신청)'/'여성(대기신청)' 등 접두 매칭
                for gvc, gfull in re.findall(r"'(O[0-9a-f]{10,})',\s*'((?:남성|여성)[^']*)'", h2):
                    gender = '남성' if gfull.startswith('남성') else '여성'
                    if gender in out:
                        continue
                    soldout = ('대기' in gfull) or ('마감' in gfull)
                    h3 = self._load_option_html(page, idx, [(oc1, vc, vn), (oc2, gvc, gfull)])
                    pm = re.search(r'([1-9]\d?,\d{3}|[1-9]\d{4,6})\s*원', re.sub(r'\s+', ' ', h3))
                    if pm:
                        out[gender] = (int(pm.group(1).replace(',', '')), soldout)
            return out
        except Exception as e:
            self.logger.warning(f'모드파티 성별가격 추출 실패 idx={idx}: {str(e)[:60]}')
            return out

    def _enrich_from_detail(self, data: dict, soup: BeautifulSoup) -> None:
        """상품 상세페이지에서 제목·이미지·본문·가격 보강(목록에 없던 상품 포함)"""
        # 제목: og:title 우선(깔끔), 없으면 <title>
        og_t = soup.find('meta', property='og:title')
        if og_t and og_t.get('content'):
            data['title'] = og_t['content'].strip()
        elif soup.title and soup.title.string:
            data['title'] = soup.title.string.strip()

        # 이미지: og:image 우선
        og = soup.find('meta', property='og:image')
        if og and og.get('content') and 'placeholder' not in og['content']:
            data['img'] = og['content']
        elif not data.get('img'):
            for img in soup.select('img[src*="imweb"], img[src*="cdn"]'):
                src = img.get('src', '')
                if src and 'placeholder' not in src and not src.endswith('.gif'):
                    data['img'] = src
                    break

        # 본문(해시태그·지역 키워드용)
        data['desc'] = self._extract_description(soup)

        body_text = soup.get_text(' ', strip=True)
        data['detail_text'] = body_text[:4000]

        # 장소: "📍 <장소>" (예: 압구정 식스나잇 / 광주 상무지구 알베르)
        loc = re.search(r'📍\s*([^📍⏰\n]{2,40})', body_text)
        if loc:
            # 지도/보기/› 등 링크 UI 텍스트 및 그 뒤 꼬리 제거
            d = re.split(r'\s*(?:지도보기|지도|보기|MAP|map|›|»|＞|>)', loc.group(1))[0]
            data['location_detail'] = re.sub(r'\s+', ' ', d).strip(' ·-')

        # 시간: "⏰ <시간문구>" (요일별 다를 수 있음: "(목,금) 19:30~21:30 / (토) 19:10~21:10")
        tm = re.search(r'⏰\s*([^📍⏰\n]{2,60})', body_text)
        if tm:
            data['time_text'] = tm.group(1).strip()

        # 가격: 임베드 상품 JSON("price":44000) 우선, 없으면 본문 첫 1만원 이상
        html = str(soup)
        pj = re.search(r'"(?:price|prod_price)"\s*:\s*(\d{4,6})', html)
        if pj:
            data['price'] = int(pj.group(1))
        elif not data.get('price'):
            for m in self.PRICE_PATTERN.finditer(body_text):
                val = int(m.group(1).replace(',', ''))
                if val >= 10000:
                    data['price'] = val
                    break

        # 날짜별 좌석/품절: "7월 10일(금) : 남 13/16 여 12/16" 또는 콜론 없이
        # "8월 15일 (토)남 12/14여 10/14" 형태(상품마다 문구가 다르다 — 콜론 선택적).
        # 예약위젯(실시간 남/여 인원)은 죽은 Supabase 도메인에 의존해 더 이상 렌더링되지
        # 않아 본문 텍스트(body_text)엔 이 숫자가 없다 — 대신 서버가 SEO용으로 심어둔
        # JSON-LD(schema.org Product) description 필드엔 위젯과 무관하게 항상 들어있다.
        # 날짜 항목들이 구분자 없이 그대로 이어붙어("...여 12/168월 15일...") 있어
        # 좌석수 자릿수를 1~2자리로 제한해야 다음 날짜의 월(月) 숫자를 삼키지 않는다.
        ld_desc = ''
        for tag in soup.find_all('script', type='application/ld+json'):
            try:
                ld = json.loads(tag.string or tag.get_text())
            except Exception:
                continue
            if isinstance(ld, dict) and ld.get('@type') == 'Product':
                ld_desc = ld.get('description', '') or ''
                if not data.get('price'):
                    offer_price = (ld.get('offers') or {}).get('price')
                    if offer_price:
                        data['price'] = int(offer_price)
                break

        seats = {}
        for m in re.finditer(
            r'(\d{1,2})월\s*(\d{1,2})일[^:：남]*[:：]?\s*남\s*(\d{1,3})\s*/\s*(\d{1,2})\s*여\s*(\d{1,3})\s*/\s*(\d{1,2})',
            ld_desc or body_text,
        ):
            mo, d = int(m.group(1)), int(m.group(2))
            seats[(mo, d)] = {
                'male': (int(m.group(3)), int(m.group(4))),
                'female': (int(m.group(5)), int(m.group(6))),
            }
        data['seats'] = seats

        # 좌석수(남/여) 문구가 아예 없는 상품(예: 커피 살롱류)도 상세페이지 상단
        # 날짜 배지("8/16(일) 8/23 (일)")는 항상 뜬다 — 좌석 정보 없이도 일정 자체는
        # 살려서 이벤트로 만들 수 있게 별도로 모아둔다(_build_events 에서 seats 와 합집합).
        badge_dates = set()
        for m in re.finditer(r'(\d{1,2})/(\d{1,2})\s*\([일월화수목금토]\)', body_text):
            badge_dates.add((int(m.group(1)), int(m.group(2))))
        data['badge_dates'] = badge_dates

        # 나이(년생)는 메인 이미지(og:image)에서 OCR 워커로 1회 추출(KV 캐시)
        if data.get('img') and not data.get('age_ocr'):
            data['age_ocr'] = self._fetch_age(data['img'])

    def _build_events(self, product_data: dict[str, dict], future_prods: set[str]) -> list[EventModel]:
        """booking_counts 일정을 정본으로, 상품별 미래 회차를 전량 이벤트화."""
        events: list[EventModel] = []
        seen_keys: set[str] = set()

        for idx in future_prods:
            data = product_data.get(idx)
            if not data:
                continue

            text = (data.get('text') or '')
            detail_text = (data.get('detail_text') or '')
            desc = data.get('desc') or ''
            img_url = data.get('img')
            # 목록 페이지의 지연 로딩(lazy-load) 이미지는 뷰포트에 안 걸리면 실제 사진
            # 대신 1x1 placeholder_image.cm 을 그대로 물고 있다. 상세페이지 보강
            # (_enrich_from_detail)이 개별 상품마다 실패할 수 있는데(타임아웃 등, 위
            # 128-144행에서 warning만 남기고 계속 진행), 그 경우 이 placeholder 가
            # 그대로 thumbnail_urls 에 저장됐다(2026-08-13, 오너가 앱에서 실제로
            # 빈 이미지를 발견해 확인 — 압구정 2030 와인파티·청담 돌싱 와인파티).
            # 저장 직전에 한 번 더 걸러 나쁜 URL이 DB에 들어가지 않게 한다.
            if img_url and 'placeholder' in img_url:
                img_url = None
            url = data.get('url') or f'{self.BASE_URL}/shop_view/?idx={idx}'

            # 제목: 목록 텍스트의 유의미한 첫 줄 우선, 없으면 상세 og:title
            title_line = ''
            for line in [l.strip() for l in text.split('\n') if l.strip()]:
                if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                    title_line = line
                    break
            if not title_line:
                title_line = (data.get('title') or '').strip()
            # 가격·날짜·세일배지 꼬리 제거
            title_line = re.split(r'\s+[\d,]{3,}원|\s+\d{1,2}/\d{1,2}\(', title_line)[0].strip()
            if not title_line:
                continue  # 제목 없는 정크 상품 스킵
            # 사이트 기본 og:title(제품명 못 얻은 상품) 스킵 — 지역·제목 신뢰 불가
            if '로테이션 소개팅의 기준' in title_line or title_line.strip('| ') == '모드파티':
                self.logger.info(f'모드파티 idx={idx} 제품명 확보 실패(기본 og:title) — 스킵')
                continue

            scan = ' '.join([title_line, text, desc])
            # 지역: 제목의 지명 우선(모드파티 제목엔 지역 확실). 없으면 상세페이지 "📍 장소"(location_detail)
            # 나 본문에서 공용 해석기로 재시도(2026-07-25: idx=354처럼 제목엔 지역이 없어도
            # 예약 캘린더 섹션의 "📍 강남역 알베르"엔 있는 케이스가 있어 '기타'로 새던 것 수정).
            region = self._region_from_title(title_line) or resolve_region(
                title=title_line, location_detail=data.get('location_detail'), body=detail_text,
            )

            # 나이: 메인 이미지 OCR(남/여 년생) → 만나이 문자열로 저장(출생년도는 앱/admin이 역산 표시).
            _, _, band_label = self._parse_age_group(scan)
            age_ocr = data.get('age_ocr') or {}
            m_str, m_lo, m_hi = self._age_str_from_birth(age_ocr.get('male'))
            f_str, f_lo, f_hi = self._age_str_from_birth(age_ocr.get('female'))
            if m_str or f_str:
                age_male, age_female = m_str, f_str
                los = [x for x in (m_lo, f_lo) if x is not None]
                his = [x for x in (m_hi, f_hi) if x is not None]
                age_min = min(los) if los else None
                age_max = max(his) if his else None
                age_label = band_label
            else:
                age_male = age_female = None
                age_min, age_max, age_label = self._parse_age_group(scan)

            # 성별 실가격(예약위젯). 한 성별 옵션이 없으면 그 성별 매진으로 본다.
            base = data.get('price')
            if not base:
                pmatch = self.PRICE_PATTERN.search(text)
                if pmatch:
                    val = int(pmatch.group(1).replace(',', ''))
                    if val >= 10000:
                        base = val
            price_male = data.get('price_male')
            price_female = data.get('price_female')
            # 매진(대기신청)은 위젯 옵션명으로 판별 — 가격은 있음.
            male_sold = bool(data.get('male_sold'))
            female_sold = bool(data.get('female_sold'))
            if price_male is None and price_female is None:
                price_male = price_female = base   # 추출 실패 → base 폴백
                male_sold = female_sold = False
            elif price_male is None:
                price_male = base
            elif price_female is None:
                price_female = base

            theme = ['와인'] if '와인' in scan else ['일반']
            if '요리' in scan or '쿡' in scan:
                theme = ['쿠킹']

            title = sanitize_text(f'[모드파티] {title_line}', 80)

            # 일정 정본 — 예전엔 모드파티 자체 Supabase(booking_counts) 하나만 봤는데,
            # 그 프로젝트가 통째로 사라져(2026-08-13 확인: lqxfkqxrtjnqozqmwzlp.supabase.co
            # 가 공개 DNS에서도 NXDOMAIN — 실시간 위젯 스크립트까지 그 도메인에서 받아오다보니
            # 위젯 자체가 브라우저에서도 로드 실패, booking-date-config HTML 폴백도 같이
            # 무력화됨) 미래 상품이 0개로 집계되며 9일간 크롤이 통째로 비었다. 상품 상세
            # 본문에 박힌 "8월 14일(금) : 남 14/16 여 12/16" 문구(_enrich_from_detail 이
            # 이미 seats 로 파싱해 두고 있었다 — Supabase 와 무관하게 그 자체로 날짜 정본이
            # 될 수 있는데 안 쓰고 있었다)를 이제 같이 날짜 소스로 합친다. 둘 다 있으면
            # 중복 없이 합집합, Supabase 가 살아나도 그대로 같이 쓸 수 있다.
            seat_date_codes = {
                f'{mo:02d}{d:02d}' for (mo, d) in (data.get('seats') or {}).keys()
            }
            # 좌석수 문구 자체가 없는 상품(커피 살롱 등)은 날짜 배지만으로 일정을 살린다.
            badge_date_codes = {
                f'{mo:02d}{d:02d}' for (mo, d) in (data.get('badge_dates') or set())
            }
            all_date_codes = (
                seat_date_codes
                | set(self._booking_counts.get(idx, {}).keys())
                | badge_date_codes
            )

            for date_code in all_date_codes:
                event_date = self._parse_date_code(date_code)
                if not event_date or not is_within_one_month(event_date):
                    continue

                date_key = f'{idx}_{event_date.strftime("%Y%m%d")}'
                if date_key in seen_keys:
                    continue
                seen_keys.add(date_key)

                # 시간: 요일별 시간 문구에서 해당 날짜 시작시각 적용(하드코딩 금지)
                tt = self._time_for_date(data.get('time_text'), event_date)
                if tt:
                    event_date = event_date.replace(hour=tt[0], minute=tt[1])
                else:
                    event_date = event_date.replace(hour=19, minute=0)  # 저녁 파티 기본
                    self.logger.warning(f'모드파티 idx={idx} 시간 파싱 실패(19:00 기본): {data.get("time_text")}')

                # 좌석·품절: 상품페이지 "남 X/Y 여 X/Y"(날짜별) 우선, 없으면 booking_counts.
                # date_code 가 seats 쪽에서만 왔을 수 있어(booking_counts 는 지금 항상 비어
                # 있다) 직접 인덱싱하면 KeyError — 없으면 빈 dict(아래 seat 블록이 채운다).
                row = self._booking_counts.get(idx, {}).get(date_code, {})
                bc_male = row.get('male_count', 0) or 0
                bc_female = row.get('female_count', 0) or 0
                seat = (data.get('seats') or {}).get((event_date.month, event_date.day))
                seats_left_male = seats_left_female = None
                capacity_male = capacity_female = None
                is_closed = False
                if seat:
                    cm, capm = seat['male']
                    cf, capf = seat['female']
                    bc_male, bc_female = cm, cf
                    capacity_male, capacity_female = capm, capf
                    seats_left_male = max(0, capm - cm)
                    seats_left_female = max(0, capf - cf)
                    is_closed = seats_left_male <= 0 and seats_left_female <= 0
                elif row.get('max_capacity'):
                    bc_max = row['max_capacity']
                    capacity_male = capacity_female = bc_max
                    seats_left_male = max(0, bc_max - bc_male)
                    seats_left_female = max(0, bc_max - bc_female)
                    is_closed = seats_left_male <= 0 and seats_left_female <= 0
                # 예약위젯에서 성별 옵션이 없던 성별 = 매진 → 좌석 0(앱 취소선 '마감'). 둘 다면 is_closed.
                if male_sold:
                    seats_left_male = 0
                if female_sold:
                    seats_left_female = 0
                if male_sold and female_sold:
                    is_closed = True
                participant_stats = {
                    'male_count': bc_male,
                    'female_count': bc_female,
                    'max_capacity': capacity_male,
                    'date_label': row.get('date_label', ''),
                    'source': 'modparty_seats' if seat else 'supabase_booking_counts',
                }

                unique_url = f'{url.split("#")[0]}#evt={event_date.strftime("%Y%m%d%H%M")}'
                try:
                    events.append(EventModel(
                        title=title,
                        description=desc or None,
                        event_date=event_date,
                        location_region=region,
                        location_detail=data.get('location_detail'),
                        price_male=price_male,
                        price_female=price_female,
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
                        age_male=age_male,
                        age_female=age_female,
                        age_group_label=age_label,
                        is_closed=is_closed,
                        participant_stats=participant_stats,
                    ))
                except Exception:
                    continue

        age_count = sum(1 for e in events if e.age_range_min is not None)
        self.logger.info(
            f'모드파티 이벤트 {len(events)}개 생성 (미래 상품 {len(future_prods)}개, 나이대 {age_count}개)'
        )
        return events
