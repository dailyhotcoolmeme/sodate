"""감정적인 오렌지들 (emotional0ranges.com) 스크래퍼 — imweb 기반, Playwright

수집 흐름:
1. /date 페이지 → 상품 링크(idx) 목록 수집
2. 각 상품 페이지 → 날짜/나이코드 옵션 + 블로그 참여자 명단 링크 추출
3. 블로그 참여자 명단(네이버 블로그) → 날짜별 participant_stats 파싱
4. 상품 옵션 날짜와 블로그 이벤트 매칭 → EventModel 생성
"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright, Page, Frame
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month
from utils.region import resolve_region
from utils.imweb_options import gender_soldout_by_label


# 잔여석 한글 수사 → 정수
SEAT_WORDS = {'한자리': 1, '두자리': 2, '세자리': 3, '네자리': 4, '다섯자리': 5}


def _eo_age_disp(mn: Optional[int], mx: Optional[int]) -> Optional[str]:
    """age_range → 앱 나이 표시 문자열(만나이). 감정오렌지 그룹연령(A~G)은 남성 전용 기준
    (여성은 전 라인 공통 '제한 없음' — 이 함수는 age_male 표시에만 쓴다, 2026-07-25 확정)."""
    # ⚠️(2026-09-07) 한쪽 경계만 있을 때 '35~' '~37' 로 내면 앱에 그대로 나온다
    #    (앱은 'NN'/'NN~NN' 일 때만 '세' 를 붙인다). 사람이 읽는 말로 보낸다.
    if mn is not None and mx is not None:
        return f'{mn}~{mx}'
    if mx is not None:
        return f'{mx}세 이하'
    if mn is not None:
        return f'{mn}세 이상'
    return None


def _title_place(title_line: Optional[str]) -> Optional[str]:
    """제목 대괄호 안 지명을 '그대로' 반환 (예: '가산디지털단지', '강남 삼성', '송파 문정')."""
    m = re.search(r'\[([^\]]+)\]', title_line or '')
    return m.group(1).strip() if m else None


class EmotionalOrangeScraper(BaseScraper):
    # ⚠️(2026-09-07) 업체가 사이트를 새로 만들면서 emotional0ranges.com 이 통째로 바뀌었다.
    #    · /date  → 새 화면 /meetups 로 넘어가는데 거기엔 각 모임으로 가는 링크가 아직 없다
    #    · /shop_view/?idx=N → 404
    #    그래서 09-06 08:02 부터 크롤이 «수집 0건»으로 매번 실패했고, 앱에 저장돼 있던
    #    일정 273건의 신청 링크도 전부 404가 됐다(이용자가 실제로 404를 보고 있었다).
    #
    #    옛 화면은 imweb 주소로 그대로 살아 있다(목록 28개·상세 200 정상). 지금은 각 모임의
    #    주소가 있는 곳이 여기뿐이라 이쪽을 본다. 기존 273건의 source_url 도 같이 옮겼다
    #    (안 옮기면 전부 새 일정으로 잡혀 중복이 쌓인다).
    #
    #    ※ 업체가 이전을 끝내면 이 주소도 사라진다. 그때는 새 /meetups 구조로 다시 짜야 한다.
    BASE_URL = 'https://emotional0ranges1.imweb.me'
    DATE_PAGE_URL = 'https://emotional0ranges1.imweb.me/date'

    # 예약위젯(load_option.cm)에서 성별 가격·매진을 정확히 추출 → DB 기록
    WRITES_PRICE = True
    WRITES_SEATS = True
    # 매 크롤마다 전 상품의 예약위젯 일시를 전수 확인 → 사라진 회차 정리 가능.
    # (2026-07-28: 사케시그널 시간이 19:00→18:00으로 바뀌었는데 옛 19:00 회차가
    #  남아 앱에 틀린 시간이 노출되고 있었음)
    DELETE_STALE = True

    # 제목 대괄호의 동네 키워드 → 지역 라벨. 앞에서부터 매칭(첫 매칭 우선)하므로
    # 더 구체적인 키워드를 앞에 둔다.
    REGION_MAP = {
        # 강남권
        '역삼': '강남', '선릉': '강남', '강남': '강남', '서초': '강남', '교대': '강남',
        '삼성': '강남', '신논현': '강남', '논현': '강남',
        # 송파/잠실
        '송파': '송파', '잠실': '송파', '문정': '송파', '가락': '송파', '석촌': '송파',
        # 영등포/여의도
        '영등포': '영등포', '여의도': '영등포',
        # 용산
        '용산': '용산', '한남': '용산', '이태원': '용산', '삼각지': '용산',
        # 홍대/마포
        '홍대': '홍대', '마포': '홍대', '합정': '홍대', '연남': '홍대', '망원': '홍대',
        # 성수
        '성수동': '성수', '성수': '성수', '뚝섬': '성수', '서울숲': '성수',
        # 건대
        '건대입구': '건대', '건대': '건대', '군자': '건대', '어린이대공원': '건대',
        # 신촌
        '신촌': '신촌', '이대': '신촌', '이화여대': '신촌',
        # 종로
        '종로': '종로', '광화문': '종로', '을지로': '종로', '안국': '종로',
        '인사동': '종로', '종각': '종로', '시청': '종로',
        # 서남권
        '가산': '가산', '구로': '구로', '마곡': '강서', '강서': '강서',
        # 경기
        '분당': '분당', '판교': '분당', '정자': '분당',
        '수원': '수원', '광교': '수원', '동탄': '동탄', '화성': '동탄',
        '하남': '하남', '미사': '하남', '일산': '일산', '고양': '일산',
        # 광역시
        '부산': '부산', '대구': '대구', '대전': '대전', '인천': '인천', '광주': '광주',
    }

    # "N월 N일" 패턴 (리뷰 제외: [옵션] 으로 시작하는 라인은 과거 리뷰)
    DATE_RE = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    TIME_RE = re.compile(r'(오전|오후|저녁|낮|새벽)\s*(\d{1,2})시(?:\s*(\d{2})분)?')
    PRICE_RE = re.compile(r'([\d,]+)원')
    # 나이 코드 패턴: (나이A), (나이B) ... (나이G)
    AGE_CODE_RE = re.compile(r'\(나이([A-G])\)')
    # 블로그 날짜 패턴 (전체 매치)
    BLOG_DATE_RE = re.compile(
        r'^(\d{1,2})월\s*(\d{1,2})일\s*\((.+?)\)\s*(오전|오후|저녁|낮|새벽)?\s*(\d{1,2})시'
    )
    # 나이 범위 패턴
    AGE_RANGE_RE = re.compile(r'만\s*(\d+)[~\-](\d+)세')

    # 티키타카 소개팅 나이 코드 → (min_age, max_age) 매핑 (만 나이 기준)
    AGE_CODE_MAP: dict[str, tuple[Optional[int], Optional[int]]] = {
        'A': (23, 28),
        'B': (26, 31),
        'C': (29, 34),
        'D': (32, 37),
        'E': (35, 40),
        'F': (38, 43),
        'G': (41, 49),
    }
    # 블랙라운지 소개팅(블랙멤버 전용) — 티키타카와 그룹별 연령이 다름(2026-07-25 오너 스샷으로 확인).
    AGE_CODE_MAP_BLACKLOUNGE: dict[str, tuple[Optional[int], Optional[int]]] = {
        'A': (23, 29),
        'B': (27, 33),
        'C': (31, 37),
        'D': (35, 41),
        'E': (39, 46),
    }
    # 돌싱 티키타카 소개팅(돌싱만남 전용). D/E는 '무자녀 돌싱 전용' 한쪽경계만(이하/이상).
    AGE_CODE_MAP_DOLSING: dict[str, tuple[Optional[int], Optional[int]]] = {
        'A': (25, 35),
        'B': (33, 43),
        'C': (41, 51),
        'D': (None, 37),
        'E': (35, None),
    }

    def __init__(self):
        super().__init__('emotional-orange')

    def _age_code_map_for(self, title_line: str) -> dict:
        """상품 제목으로 어느 상세정보 나이표(티키타카/블랙라운지/돌싱) 소속인지 판별.
        하나의 AGE_CODE_MAP을 전 상품에 그대로 쓰면 블랙라운지·돌싱 상품엔 틀린
        나이가 매핑됨(그룹당 연령이 라인마다 다름, 2026-07-25 오너 스샷으로 확인)."""
        t = title_line or ''
        if '돌싱' in t:
            return self.AGE_CODE_MAP_DOLSING
        if '블랙' in t:
            return self.AGE_CODE_MAP_BLACKLOUNGE
        return self.AGE_CODE_MAP

    # ------------------------------------------------------------------ #
    # 공개 진입점
    # ------------------------------------------------------------------ #

    # ------------------------------------------------------------------ #
    # 새 사이트(2026-09 개편) — 기본 경로
    # ------------------------------------------------------------------ #

    NEW_SITE = 'https://emotional0ranges.com'

    def _scrape_new_site(self) -> list[EventModel]:
        """새 사이트에서 수집. 브라우저 없이 자료만 받아 오므로 몇 초면 끝난다.

        업체가 2026-09 에 imweb 쇼핑몰에서 자체 사이트로 갈아탔다. 새 사이트는 화면 주소
        뒤에 `.data` 를 붙이면 화면이 쓰는 자료를 그대로 준다 — 성별 가격·정원·잔여석·
        나이가 전부 숫자로 들어 있어, HTML에서 글자로 뽑아내던 옛 방식보다 정확하다.
        """
        from scrapers.emotional_orange_new import (
            fetch_meetups, fetch_sessions, age_text, age_range, age_applies_to, _num,
        )

        events: list[EventModel] = []
        meetups = fetch_meetups()
        if not meetups:
            return []
        self.logger.info(f'감정오렌지(새 사이트) 모임 {len(meetups)}개 발견')

        skipped: list[str] = []
        for m in meetups:
            mid = str(m.get('id'))
            try:
                prog, sessions = fetch_sessions(mid)
            except Exception as e:
                skipped.append(mid[:8])
                self.logger.warning(f'감정오렌지(새) 모임 {mid[:8]} 읽기 실패: {e}')
                continue
            if not sessions:
                continue

            title_line = str(prog.get('title') or m.get('title') or '').strip()
            region = str(prog.get('region') or '').strip() or '서울'
            image = prog.get('imageUrl') or m.get('imageUrl')
            fmt = prog.get('format')

            for sess in sessions:
                starts = sess.get('startsAt')
                if not isinstance(starts, str):
                    continue
                try:
                    event_date = datetime.fromisoformat(starts).replace(tzinfo=None)
                except Exception:
                    continue

                gp = sess.get('genderPrices') if isinstance(sess.get('genderPrices'), dict) else {}
                price_m, price_f = _num(gp.get('male')), _num(gp.get('female'))
                rem_m, rem_f = _num(sess.get('remainingMale')), _num(sess.get('remainingFemale'))
                # 업체가 '마감'이라고 알려주면 그대로 따른다. 잔여석 0 도 마감으로 본다.
                closed = bool(sess.get('purchaseClosed')) or str(sess.get('status')) == 'CLOSED'
                if rem_m == 0 and rem_f == 0:
                    closed = True

                # 일정 하나를 가리키는 주소. 새 사이트에서 실제로 열리는 주소여야 한다.
                source_url = (
                    f'{self.NEW_SITE}/meetups/{mid}'
                    f'#evt={event_date.strftime("%Y%m%d%H%M")}'
                )
                # 나이는 «누구에게 걸리는지»까지 보고 넣는다. 대부분 남성 기준이지만
                # 사이트가 ALL/F 로 주는 것도 있어서 그대로 따른다.
                age = age_text(sess)
                lo, hi = age_range(sess)
                who = age_applies_to(sess)
                # 2026-07-25 오너 확인: 여성은 전 라인 공통 '제한 없음'.
                # 다만 사이트가 여성·공통 조건을 준 건은 그 값을 쓴다.
                age_m = age if who in ('M', 'ALL') else None
                age_f = age if who in ('F', 'ALL') else '제한 없음'
                try:
                    events.append(EventModel(
                        title=sanitize_text(f'[에모셔널오렌지] {title_line}', 80),
                        event_date=event_date,
                        location_region=region,
                        price_male=price_m,
                        price_female=price_f,
                        capacity_male=_num(sess.get('capacityMale')),
                        capacity_female=_num(sess.get('capacityFemale')),
                        seats_left_male=rem_m,
                        seats_left_female=rem_f,
                        source_url=source_url,
                        thumbnail_urls=[image] if isinstance(image, str) and image.startswith('http') else [],
                        is_closed=closed,
                        age_male=age_m,
                        age_female=age_f,
                        age_range_min=lo,
                        age_range_max=hi,
                        format=fmt if isinstance(fmt, str) else None,
                    ))
                except Exception as e:
                    self.logger.warning(f'감정오렌지(새) 일정 만들기 실패: {e}')

        if skipped:
            self.logger.warning(
                f'감정오렌지(새) 모임 {len(meetups)}개 중 {len(skipped)}개 못 가져옴 — 이만큼 일정이 빠집니다'
            )
        self.logger.info(f'감정오렌지(새 사이트) 일정 {len(events)}건')
        return events

    def scrape(self) -> list[EventModel]:
        # 새 사이트를 먼저 본다. 업체가 옛 imweb 을 닫아도 여기서 그대로 나온다.
        try:
            fresh = self._scrape_new_site()
            if fresh:
                return self._finalize(fresh)
            self.logger.warning('감정오렌지 새 사이트에서 0건 — 옛 imweb 으로 넘어간다')
        except Exception as e:
            self.logger.warning(f'감정오렌지 새 사이트 수집 실패({e}) — 옛 imweb 으로 넘어간다')

        events: list[EventModel] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent=(
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/121.0.0.0 Safari/537.36'
                    ),
                )
                page = context.new_page()

                # 1. /date 페이지에서 상품 목록 수집
                #
                # ⚠️(2026-09-05) 여기서 networkidle 을 못 기다리면 예외가 바깥 try 로 튀어
                #    크롤이 통째로 죽고 0건으로 끝났다(crawl_logs 의 'failed 0건 / 15~24초'
                #    기록들이 전부 이것이다). networkidle 은 «네트워크가 조용해졌나»일 뿐
                #    화면이 비었다는 뜻이 아니다 — 못 기다려도 그냥 진행한다.
                page.goto(self.DATE_PAGE_URL, timeout=20000)
                try:
                    page.wait_for_load_state('networkidle', timeout=10000)
                except Exception:
                    self.logger.info('감정오렌지 목록 페이지 로딩이 느려 기다리지 않고 진행')
                time.sleep(2)

                products = self._collect_products(page)
                self.logger.info(f'감정오렌지 상품 {len(products)}개 발견')

                # 블로그 URL → 참여자 통계 캐시 (동일 블로그를 여러 상품이 공유)
                blog_cache: dict[str, dict[str, dict]] = {}

                # 2. 각 상품 페이지에서 날짜 + 블로그 링크 추출
                #
                # ⚠️(2026-09-05) 여기서 상품 하나가 통째로 버려지고 있었다.
                #    상품마다 담긴 일정 수가 1건에서 33건까지 제각각이라, 큰 상품 하나만
                #    놓쳐도 33건이 사라진다. 서너 개 놓치면 299건이 144~180건이 된다
                #    (실측: idx=63 이 networkidle 8초를 못 넘겨 27개만 처리 → 271건).
                #    워치독이 이걸 '급락'으로 잡아 오탐 메일을 계속 보냈다.
                #    → networkidle 은 «네트워크가 조용해졌나»일 뿐 화면이 없다는 뜻이 아니다.
                #      못 기다렸다고 상품을 버리지 않는다. 그리고 한 번은 다시 해본다.
                skipped: list[str] = []
                for idx, data in products.items():
                    try:
                        last_err: Exception | None = None
                        for attempt in (1, 2):
                            try:
                                page.goto(data['url'], timeout=15000)
                                last_err = None
                                break
                            except Exception as e:
                                last_err = e
                                if attempt == 1:
                                    self.logger.warning(
                                        f'감정오렌지 상품 idx={idx} 열기 실패 — 다시 시도: {e}'
                                    )
                                    time.sleep(2)
                        if last_err is not None:
                            raise last_err

                        # 여기서 시간이 넘어도 그냥 진행한다. 지금까지 그려진 것만으로도
                        # 대부분 파싱된다 — 통째로 버리는 것보다 언제나 낫다.
                        try:
                            page.wait_for_load_state('networkidle', timeout=8000)
                        except Exception:
                            self.logger.info(
                                f'감정오렌지 상품 idx={idx} 로딩이 느려 기다리지 않고 진행'
                            )
                        time.sleep(1.5)

                        soup = BeautifulSoup(page.content(), 'html.parser')

                        # 예약위젯 매진·가격 — ⚠️ 블로그 파싱이 페이지를 이동시키기 전(상품 페이지 상태)에 호출
                        try:
                            data['widget'] = gender_soldout_by_label(page, idx)
                        except Exception as e:
                            self.logger.warning(f'감정오렌지 위젯 매진 추출 실패(idx={idx}): {e}')
                            data['widget'] = {}

                        # 블로그 참여자 명단 링크 추출
                        blog_url = self._extract_blog_url(soup)
                        data['blog_url'] = blog_url

                        # 블로그 캐시 활용 (같은 URL은 한 번만 파싱)
                        if blog_url and blog_url not in blog_cache:
                            try:
                                blog_cache[blog_url] = self._fetch_blog_participant_stats(
                                    page, blog_url
                                )
                            except Exception as e:
                                self.logger.warning(
                                    f'감정오렌지 블로그 파싱 실패(idx={idx}): {e}'
                                )
                                blog_cache[blog_url] = {}
                        data['blog_events_map'] = blog_cache.get(blog_url or '', {})

                        new_events = self._parse_product_page(page, soup, idx, data)
                        events.extend(new_events)
                    except Exception as e:
                        skipped.append(idx)
                        self.logger.warning(f'감정오렌지 상품 idx={idx} 파싱 실패: {e}')

                # 몇 개를 못 가져왔는지 반드시 남긴다 — 예전엔 조용히 빠져서, 건수가 줄어도
                # 사이트가 바뀐 건지 몇 개 놓친 건지 로그로 구분할 수가 없었다.
                if skipped:
                    self.logger.warning(
                        f'감정오렌지 상품 {len(products)}개 중 {len(skipped)}개 못 가져옴 '
                        f'(idx={",".join(skipped)}) — 이만큼 일정이 빠집니다'
                    )

                browser.close()
        except Exception as e:
            self.logger.error(f'감정오렌지 크롤링 실패: {e}')

        return self._finalize(events)

    def _finalize(self, events: list[EventModel]) -> list[EventModel]:
        """중복 제거 + 한 달 넘는 일정 제외. 새 사이트·옛 imweb 두 경로가 같이 쓴다."""
        seen: set[str] = set()
        unique = [
            ev for ev in events
            if ev.source_url not in seen and not seen.add(ev.source_url)  # type: ignore
        ]
        filtered = []
        for ev in unique:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'감정오렌지 총 {len(filtered)}개 이벤트 (필터 전: {len(unique)}개)')
        return filtered

    # ------------------------------------------------------------------ #
    # 상품 목록 수집
    # ------------------------------------------------------------------ #

    def _collect_products(self, page: Page) -> dict[str, dict]:
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

    # ------------------------------------------------------------------ #
    # 본문(description) 추출
    # ------------------------------------------------------------------ #

    # 네비/푸터/광고 등 보일러플레이트로 판단되는 라인 (부분일치 제외)
    _DESC_BOILERPLATE = (
        '로그인', '회원가입', '장바구니', '마이페이지', '주문조회', '고객센터',
        '이용약관', '개인정보', '취소/환불', '반품', '교환', '배송', '사업자',
        '대표자', '상호명', '통신판매', '고객문의', 'copyright', 'Copyright',
        'COPYRIGHT', 'All rights', 'ALL RIGHTS', '전체보기', '카테고리',
        '검색어', 'SEARCH', '위시리스트', '최근본상품', 'TOP', '바로가기',
        '네이버', '카카오', '인스타', '페이스북', '유튜브', '블로그 바로',
        '이용안내', '공지사항', '자주묻는', 'FAQ', 'Q&A', '리뷰쓰기',
    )

    def _extract_description(self, soup: BeautifulSoup) -> Optional[str]:
        """상품 상세 페이지에서 소개팅 설명 본문 텍스트를 추출한다.

        og:description / meta description 요약 + 상세 본문 영역의 핵심 텍스트를
        모아 보일러플레이트를 걸러내고 최대 800자로 캡한다. 빈 값이면 None.
        """
        parts: list[str] = []
        seen_lines: set[str] = set()

        def _push(raw: Optional[str]) -> None:
            if not raw:
                return
            for ln in re.split(r'[\n\r]+', raw):
                ln = ln.strip()
                if len(ln) < 4:
                    continue
                # 한글이 없는 라인(순수 영문/숫자 UI)은 스킵
                if not re.search(r'[가-힣]', ln):
                    continue
                # 보일러플레이트 라인 제외
                if any(bp in ln for bp in self._DESC_BOILERPLATE):
                    continue
                # 가격/잔여석/옵션 날짜 라인은 본문 특색과 무관 → 제외
                if re.match(r'^[\d,]+\s*원$', ln):
                    continue
                if ln in seen_lines:
                    continue
                seen_lines.add(ln)
                parts.append(ln)

        # 1. 메타 요약 (짧고 특색이 압축돼 있어 우선)
        og_desc = soup.find('meta', property='og:description')
        if og_desc and og_desc.get('content'):
            _push(og_desc['content'])
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc and meta_desc.get('content'):
            _push(meta_desc['content'])

        # 2. 상품 상세 본문 영역 (imweb / 에디터 컨테이너 우선)
        body = None
        for kw in (
            'prd_detail', 'product_detail', 'shop_detail', 'shop_view',
            'detail_info', 'prd-detail', 'product_info', 'goods_detail',
            'se-main-container', 'editor', 'content_detail', 'prd_content',
        ):
            el = soup.find(attrs={'id': re.compile(kw, re.I)})
            if el is None:
                el = soup.find(attrs={'class': re.compile(kw, re.I)})
            if el is not None:
                body = el
                break

        if body is not None:
            _push(body.get_text(separator='\n', strip=True))

        if not parts:
            return None

        combined = ' '.join(parts)
        return sanitize_text(combined, 800)

    # ------------------------------------------------------------------ #
    # 블로그 URL 추출
    # ------------------------------------------------------------------ #

    def _extract_blog_url(self, soup: BeautifulSoup) -> Optional[str]:
        """상품 페이지에서 '이번 주 참여자 ... 보러가기' 링크의 블로그 URL 추출."""
        for a in soup.find_all('a', href=re.compile(r'blog\.naver\.com')):
            href = a.get('href', '')
            txt = a.get_text(strip=True)
            # 참여자 명단 링크만 (블로그 홈 제외)
            if re.search(r'/\d{9,}', href):
                return href
        return None

    # ------------------------------------------------------------------ #
    # 상품 페이지 파싱
    # ------------------------------------------------------------------ #

    def _parse_product_page(
        self, page: Page, soup: BeautifulSoup, idx: str, listing_data: dict
    ) -> list[EventModel]:
        events: list[EventModel] = []
        listing_text = listing_data.get('text', '')
        current_year = datetime.now().year
        now = datetime.now()

        # 썸네일
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

        # 본문 설명 (상품 단위 — 이 상품의 모든 이벤트가 공유)
        description = self._extract_description(soup)

        # 제목
        title_line = ''
        for line in listing_text.split('\n'):
            line = line.strip()
            if len(line) > 5 and not re.match(r'^[\d,]+원$', line):
                title_line = line
                break

        # 가격
        prices = sorted({
            int(m.group(1).replace(',', ''))
            for m in self.PRICE_RE.finditer(listing_text)
            if int(m.group(1).replace(',', '')) >= 10000
        })
        price_male = prices[0] if prices else None
        price_female = prices[1] if len(prices) > 1 else price_male

        # 테마
        theme = ['일반']
        if '와인' in title_line:
            theme = ['와인']
        elif '쿠킹' in title_line or '요리' in title_line:
            theme = ['쿠킹']

        # 블로그에서 참여자 통계 수집 (scrape()에서 캐시된 데이터 우선 사용)
        blog_events_map: dict[str, dict] = listing_data.get('blog_events_map', {})
        if not blog_events_map:
            blog_url = listing_data.get('blog_url')
            if blog_url:
                try:
                    blog_events_map = self._fetch_blog_participant_stats(page, blog_url)
                except Exception as e:
                    self.logger.warning(f'감정오렌지 블로그 파싱 실패(idx={idx}): {e}')

        # 옵션 목록에서 날짜+나이코드 추출.
        # ⚠️ 정적 페이지(soup)의 옵션 드롭다운은 imweb이 일부만 미리 렌더링해 최대
        # 며칠~열흘 뒤까지만 잡힘(실제 사이트는 최대 +1개월까지 예약 오픈돼 있는데
        # 크롤러가 그 절반도 못 찾던 근본원인, 2026-07-24 오너 지적으로 발견).
        # 예약위젯(load_option.cm) 응답은 항상 전체 날짜(최대 40여개, +1개월)를 담고
        # 라벨 포맷도 동일("8월 30일 일요일 저녁 7시 (나이C)")하므로 이걸 우선 쓴다.
        widget_labels = list((listing_data.get('widget') or {}).keys())
        option_items = widget_labels or self._extract_option_items(soup)

        # 예약위젯 매진·가격을 (월,일,시)로 정규화해 매칭 준비
        widget_by_dt: dict = {}
        for wlab, wgd in (listing_data.get('widget') or {}).items():
            wm = self.DATE_RE.search(wlab)
            if not wm:
                continue
            wmo, wd = int(wm.group(1)), int(wm.group(2))
            whour = 19
            wt = self.TIME_RE.search(wlab)
            if wt:
                wh = int(wt.group(2))
                if wt.group(1) in ('오후', '저녁') and wh < 12:
                    wh += 12
                elif wt.group(1) == '새벽' and wh == 12:
                    wh = 0
                whour = wh
            widget_by_dt[(wmo, wd, whour)] = wgd

        seen_dates: set[str] = set()
        for opt_text in option_items:
            date_m = self.DATE_RE.search(opt_text)
            if not date_m:
                continue

            mo, d = int(date_m.group(1)), int(date_m.group(2))
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                continue

            hour, minute = 19, 0
            time_m = self.TIME_RE.search(opt_text)
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
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            # 나이 코드 추출 및 매핑
            age_range_min: Optional[int] = None
            age_range_max: Optional[int] = None
            age_group_label: Optional[str] = None
            age_code_m = self.AGE_CODE_RE.search(opt_text)
            if age_code_m:
                code = age_code_m.group(1)
                age_group_label = f'나이{code}'
                age_map = self._age_code_map_for(title_line)
                if code in age_map:
                    age_range_min, age_range_max = age_map[code]

            # 블로그 이벤트 매핑: 날짜+시간으로 lookup
            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            blog_ev = blog_events_map.get(blog_key)

            participant_stats: Optional[dict] = None
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None

            # 세부위치는 이벤트(옵션)마다 독립 계산 — 루프 간 오염 방지
            ev_location_detail: Optional[str] = None

            if blog_ev:
                participant_stats = blog_ev.get('participant_stats')
                seats_left_male = blog_ev.get('seats_left_male')
                seats_left_female = blog_ev.get('seats_left_female')
                # ⚠️(2026-07-25) 옵션라벨의 (나이X)코드→AGE_CODE_MAP이 이미 있으면 그게
                # 정본(사이트 표기 그대로, 충돌 위험 없음) — 블로그는 그게 없을 때만 보충.
                # 예전엔 블로그가 무조건 덮어써서, blog_key(월일시, 연도없음)가 다른 회차
                # 글과 충돌하면 (나이D)=32~37세인 회차가 엉뚱한 29~34세로 바뀌는 사고 발생.
                if age_range_min is None and blog_ev.get('age_range_min') is not None:
                    age_range_min = blog_ev['age_range_min']
                if age_range_max is None and blog_ev.get('age_range_max') is not None:
                    age_range_max = blog_ev['age_range_max']
                if blog_ev.get('age_group_label') and not age_group_label:
                    age_group_label = blog_ev['age_group_label']
                # 블로그 location 메타로 세부 동네/지역 보강
                blog_location = blog_ev.get('location')
                if blog_location:
                    ev_location_detail = blog_location

            # 지역 결정은 공용 해석기로 일원화 (제목 → 블로그 location → 본문 순)
            ev_region = resolve_region(
                region_phrase=_title_place(title_line),
                title=title_line,
                location_detail=ev_location_detail,
                body=description,
            )

            # 예약위젯 성별 가격·매진이 있으면 정본으로 override(실시간 매진).
            # 판매중=seats None(수량 미상), 전부품절=seats 0(마감), 옵션없음=기존 유지.
            ev_price_male, ev_price_female = price_male, price_female
            wgd = widget_by_dt.get((mo, d, hour))
            if wgd:
                if wgd.get('male'):
                    ev_price_male = wgd['male'][0]
                    seats_left_male = 0 if wgd['male'][1] else None
                if wgd.get('female'):
                    ev_price_female = wgd['female'][0]
                    seats_left_female = 0 if wgd['female'][1] else None

            source_url = (
                f'{self.BASE_URL}/shop_view/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[에모셔널오렌지] {title_line}', 80)

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=ev_region,
                    location_detail=ev_location_detail,
                    price_male=ev_price_male,
                    price_female=ev_price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=theme,
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_group_label=age_group_label,
                    # 2026-07-25 오너 스샷 확인: "모든 소개팅 여성 연령 제한 없음"(상세정보
                    # 안내 이미지, 전 라인 공통 정책) — 그룹연령(A~G)은 남성 전용 기준이라
                    # 여성에 그대로 적용하면 안 됨.
                    age_male=_eo_age_disp(age_range_min, age_range_max),
                    age_female='제한 없음',
                    participant_stats=participant_stats,
                    description=description,
                ))
            except Exception:
                continue

        # 옵션에서 아무것도 못 찾으면 폴백
        if not events:
            events = self._parse_product_page_fallback(
                soup, idx, listing_data,
                title_line, thumbnail_url,
                price_male, price_female,
                blog_events_map, description,
            )
        return events

    # ------------------------------------------------------------------ #
    # 블로그 참여자 명단 수집
    # ------------------------------------------------------------------ #

    def _fetch_blog_participant_stats(
        self, page: Page, blog_url: str
    ) -> dict[str, dict]:
        """네이버 블로그에서 날짜별 참여자 통계를 수집한다.

        반환값: {
            'MMDDH H' (예: '032520'): {
                'participant_stats': {'male': [...], 'female': [...]},
                'seats_left_male': int | None,
                'seats_left_female': int | None,
                'age_range_min': int | None,
                'age_range_max': int | None,
                'age_group_label': str | None,
                'location': str | None,
                'event_type': str | None,
            }
        }
        """
        page.goto(blog_url, timeout=20000)
        time.sleep(4)

        # 네이버 블로그는 PostView iframe 내에 실제 콘텐츠가 있음
        post_frame: Optional[Frame] = None
        for f in page.frames:
            if 'PostView' in f.url:
                post_frame = f
                break

        if post_frame is None:
            self.logger.warning(f'감정오렌지 블로그 PostView 프레임 없음: {blog_url}')
            return {}

        soup = BeautifulSoup(post_frame.content(), 'html.parser')
        return self._parse_blog_soup(soup)

    def _parse_blog_soup(self, soup: BeautifulSoup) -> dict[str, dict]:
        """블로그 BeautifulSoup 객체에서 이벤트별 참여자 통계 추출."""
        result: dict[str, dict] = {}

        for ds in soup.find_all(string=self.BLOG_DATE_RE):
            date_text = ds.strip()
            dm = self.BLOG_DATE_RE.match(date_text)
            if not dm:
                continue

            mo, d = int(dm.group(1)), int(dm.group(2))
            period = dm.group(4) or '저녁'
            hour = int(dm.group(5))
            if period in ('오후', '저녁') and hour < 12:
                hour += 12

            parent = ds.parent
            # 해당 날짜 다음의 첫 번째 참여자 테이블 탐색
            next_table = parent.find_next('table')
            if not next_table:
                continue

            # 테이블이 참여자 테이블인지 확인 (헤더: 남 | 인원 | 여)
            rows = next_table.find_all('tr')
            if not rows:
                continue
            header = [c.get_text(strip=True) for c in rows[0].find_all(['td', 'th'])]
            if '남' not in header:
                continue

            # 날짜와 테이블 사이 텍스트에서 메타 정보 추출
            location, event_type, age_min, age_max, age_group_label = \
                self._extract_between_metadata(parent, next_table)

            # 테이블 파싱
            stats = self._parse_participant_table(next_table)

            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            # 동일 날짜+시간에 여러 이벤트가 있을 경우 첫 번째 우선
            if blog_key not in result:
                # participant_stats 딕셔너리에 잔여석 정보도 포함
                ps: dict = {
                    'male': stats['male'],
                    'female': stats['female'],
                }
                if stats.get('seats_left_male') is not None:
                    ps['seats_left_male'] = stats['seats_left_male']
                if stats.get('seats_left_female') is not None:
                    ps['seats_left_female'] = stats['seats_left_female']

                result[blog_key] = {
                    'participant_stats': ps,
                    'seats_left_male': stats.get('seats_left_male'),
                    'seats_left_female': stats.get('seats_left_female'),
                    'age_range_min': age_min,
                    'age_range_max': age_max,
                    'age_group_label': age_group_label,
                    'location': location,
                    'event_type': event_type,
                }

        return result

    def _extract_between_metadata(
        self, date_parent, next_table
    ) -> tuple[
        Optional[str], Optional[str],
        Optional[int], Optional[int], Optional[str]
    ]:
        """날짜 요소와 다음 테이블 사이의 텍스트에서 지역/이벤트타입/나이범위 추출."""
        between_texts: list[str] = []
        cur = date_parent
        seen_els: set[int] = set()

        while cur and cur != next_table:
            nxt = cur.find_next()
            if nxt is None or nxt == next_table:
                break
            el_id = id(nxt)
            if el_id in seen_els:
                break
            seen_els.add(el_id)
            try:
                if next_table not in nxt.parents:
                    txt = nxt.get_text(strip=True) if hasattr(nxt, 'get_text') else ''
                    if txt and len(txt) < 100 and txt not in between_texts:
                        between_texts.append(txt)
            except Exception:
                pass
            cur = nxt
            if len(between_texts) > 25:
                break

        location: Optional[str] = None
        event_type: Optional[str] = None
        age_min: Optional[int] = None
        age_max: Optional[int] = None
        age_group_label: Optional[str] = None

        for txt in between_texts:
            txt = txt.strip()
            if not txt:
                continue
            # 지역: 순수 한글, 짧음, 코드가 없음
            if (re.match(r'^[가-힣\s]+$', txt)
                    and 3 <= len(txt) <= 12
                    and not location
                    and '초반' not in txt
                    and '중반' not in txt
                    and '후반' not in txt):
                location = txt
            # 이벤트 타입: [xxx] 또는 [ xxx ]
            elif re.match(r'^\[.+\]$', txt) and not event_type:
                event_type = txt[1:-1].strip()
            # 나이 범위
            elif '만' in txt and '세' in txt:
                am = self.AGE_RANGE_RE.search(txt)
                if am:
                    age_min, age_max = int(am.group(1)), int(am.group(2))
                # 나이 그룹 라벨 (🔔티키소개팅 C 등)
                if not age_group_label:
                    label_m = re.search(r'(?:🔔|[A-G])\s*(.+?)(?:\s+남\s*:|$)', txt)
                    if label_m:
                        age_group_label = label_m.group(1).strip()
                    else:
                        # 형태: "🔔티키소개팅 C"
                        lm2 = re.search(r'🔔(.+?)(?:\s|$)', txt)
                        if lm2:
                            age_group_label = lm2.group(1).strip()

        return location, event_type, age_min, age_max, age_group_label

    def _parse_participant_table(self, tbl) -> dict:
        """남 | 인원 | 여 형태의 3열 테이블을 파싱하여 participant_stats 반환."""
        rows = tbl.find_all('tr')
        male_data: list[dict] = []
        female_data: list[dict] = []
        seats_left_male: Optional[int] = None
        seats_left_female: Optional[int] = None

        for row in rows[1:]:  # 헤더 행 건너뜀
            cells = [
                c.get_text(separator=' ', strip=True)
                for c in row.find_all(['td', 'th'])
            ]
            if len(cells) < 3:
                continue

            male_raw = cells[0]
            female_raw = cells[2]

            # 잔여석 추출
            sm = self._extract_seats(male_raw)
            if sm is not None:
                seats_left_male = sm
            sf = self._extract_seats(female_raw)
            if sf is not None:
                seats_left_female = sf

            m_p = self._parse_participant_cell(male_raw)
            f_p = self._parse_participant_cell(female_raw)
            if m_p:
                male_data.append(m_p)
            if f_p:
                female_data.append(f_p)

        result: dict = {'male': male_data, 'female': female_data}
        if seats_left_male is not None:
            result['seats_left_male'] = seats_left_male
        if seats_left_female is not None:
            result['seats_left_female'] = seats_left_female
        return result

    @staticmethod
    def _parse_participant_cell(raw: str) -> Optional[dict]:
        """'90 초반 대기업' → {'generation': '90', 'job': '대기업'}
        generation은 대략적인 출생 연도 2자리 (90초반→'90', 90중반→'93', 90후반→'97').
        """
        raw = raw.strip()
        if not raw:
            return None
        # 마감/잔여석 문구 제외
        skip_keywords = ('마감', '남', '여', '인원', '남았어요', '한자리', '두자리',
                         '세자리', '네자리', '다섯자리')
        if any(kw in raw for kw in skip_keywords):
            return None

        m = re.match(r'^(\d{2})\s*(초반|중반|후반)\s+(.+)$', raw)
        if not m:
            return None

        decade = m.group(1)
        sub = m.group(2)
        job = m.group(3).strip()

        if sub == '초반':
            gen = decade
        elif sub == '중반':
            gen = str(int(decade) + 3).zfill(2)
        elif sub == '후반':
            gen = str(int(decade) + 7).zfill(2)
        else:
            gen = decade

        return {'generation': gen, 'job': job}

    # ------------------------------------------------------------------ #
    # 테스트 가능한 파싱 헬퍼 메서드
    # ------------------------------------------------------------------ #

    def _parse_date(self, text: str) -> Optional[datetime]:
        """날짜 문자열을 datetime으로 변환. 실패 시 None 반환.

        지원 포맷:
          '3/25 19:00'  → 현재 연도 기준
          '2026-04-10'  → ISO 날짜
        """
        text = text.strip()
        current_year = datetime.now().year

        # 'M/D HH:MM' 포맷
        m = re.match(r'^(\d{1,2})/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$', text)
        if m:
            month = int(m.group(1))
            day = int(m.group(2))
            hour = int(m.group(3)) if m.group(3) else 0
            minute = int(m.group(4)) if m.group(4) else 0
            try:
                return datetime(current_year, month, day, hour, minute)
            except ValueError:
                return None

        # 표준 포맷들
        formats = [
            '%Y-%m-%d %H:%M',
            '%Y.%m.%d %H:%M',
            '%Y-%m-%d',
            '%Y.%m.%d',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(text, fmt)
            except ValueError:
                continue
        return None

    def _extract_region(self, text: str) -> str:
        """텍스트에서 지역 키워드를 찾아 반환. 없으면 '서울'."""
        for keyword, region in self.REGION_MAP.items():
            if keyword in text:
                return region
        return '서울'

    def _extract_price_by_gender(self, text: str, gender: str) -> Optional[int]:
        """텍스트에서 성별에 맞는 가격을 추출.

        '남성 45,000원' 또는 '남성: 45,000원' 형태를 지원.
        gender='male' → 남성 가격, gender='female' → 여성 가격.
        """
        price_re = re.compile(r'([\d,]+)원')

        if gender == 'male':
            m = re.search(r'남성\s*:?\s*([\d,]+)원', text)
            if m:
                return int(m.group(1).replace(',', ''))
        elif gender == 'female':
            m = re.search(r'여성\s*:?\s*([\d,]+)원', text)
            if m:
                return int(m.group(1).replace(',', ''))

        # 성별 구분 없이 첫 번째 가격 반환
        m = price_re.search(text)
        if m:
            return int(m.group(1).replace(',', ''))
        return None

    @staticmethod
    def _extract_seats(text: str) -> Optional[int]:
        """'두자리 남았어요 🧡' → 2 / '남성 마감입니다 🧡' → 0 / 기타 → None"""
        if '마감' in text:
            return 0
        for word, count in SEAT_WORDS.items():
            if word in text:
                return count
        m = re.search(r'(\d+)자리', text)
        if m:
            return int(m.group(1))
        return None

    # ------------------------------------------------------------------ #
    # 옵션 항목 추출
    # ------------------------------------------------------------------ #

    def _extract_option_items(self, soup: BeautifulSoup) -> list[str]:
        """상품 옵션 드롭다운/select에서 일시 옵션 텍스트 목록을 추출한다."""
        result: list[str] = []
        seen: set[str] = set()

        # 방법 0: imweb 커스텀 옵션 드롭다운 (.form-select-wrap .dropdown-item) — 최우선.
        # imweb이 <select><option> 대신 div 기반 드롭다운으로 바뀌어 기존 방법1~3이
        # 옵션 날짜를 못 잡던 문제 수정. 예: "7월 2일 목요일 저녁 8시 (나이C)"
        for item in soup.select(
            '.form-select-wrap .dropdown-item, .dropdown-menu .dropdown-item, '
            '._form_select_wrap .dropdown-item'
        ):
            text = item.get_text(' ', strip=True)
            if self.DATE_RE.search(text) and text not in seen:
                result.append(text)
                seen.add(text)

        # 방법 1: <select> 태그의 <option> 요소
        for sel in soup.find_all('select'):
            for opt in sel.find_all('option'):
                text = opt.get_text(strip=True)
                if self.DATE_RE.search(text) and text not in seen:
                    result.append(text)
                    seen.add(text)

        # 방법 2: 옵션 목록 컨테이너 (JS 렌더링된 li/div 내 텍스트)
        if not result:
            for label in soup.find_all(string=re.compile(r'일시')):
                parent = label.parent
                if parent:
                    container = parent.find_next_sibling()
                    if container:
                        for item in container.find_all(['li', 'option', 'div', 'span']):
                            text = item.get_text(strip=True)
                            if self.DATE_RE.search(text) and text not in seen:
                                result.append(text)
                                seen.add(text)

        # 방법 3: 전체 텍스트에서 옵션 패턴 직접 추출 (최후 수단)
        if not result:
            full_text = soup.get_text(separator='\n', strip=True)
            option_line_re = re.compile(
                r'^\d{1,2}월\s*\d{1,2}일.*?(?:오전|오후|저녁|낮|새벽)\s*\d{1,2}시'
            )
            for line in full_text.split('\n'):
                line = line.strip()
                if line.startswith('[옵션]'):
                    continue
                if option_line_re.match(line) and line not in seen:
                    result.append(line)
                    seen.add(line)

        return result

    # ------------------------------------------------------------------ #
    # 폴백 파싱
    # ------------------------------------------------------------------ #

    def _parse_product_page_fallback(
        self,
        soup: BeautifulSoup,
        idx: str,
        listing_data: dict,
        title_line: str,
        thumbnail_url: Optional[str],
        price_male: Optional[int],
        price_female: Optional[int],
        blog_events_map: dict[str, dict],
        description: Optional[str] = None,
    ) -> list[EventModel]:
        """옵션 파싱 실패 시 전체 텍스트에서 이벤트 추출."""
        events: list[EventModel] = []
        text = soup.get_text(separator='\n', strip=True)
        current_year = datetime.now().year
        now = datetime.now()
        seen_dates: set[str] = set()

        theme = ['일반']
        if '와인' in title_line:
            theme = ['와인']
        elif '쿠킹' in title_line or '요리' in title_line:
            theme = ['쿠킹']

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
                if (event_date - now).days > 365:
                    continue
            except ValueError:
                continue

            date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
            if date_key in seen_dates:
                continue
            seen_dates.add(date_key)

            age_range_min: Optional[int] = None
            age_range_max: Optional[int] = None
            age_group_label: Optional[str] = None
            age_code_m = self.AGE_CODE_RE.search(line)
            if age_code_m:
                code = age_code_m.group(1)
                age_group_label = f'나이{code}'
                age_map = self._age_code_map_for(title_line)
                if code in age_map:
                    age_range_min, age_range_max = age_map[code]

            # 블로그 매핑
            blog_key = f'{mo:02d}{d:02d}{hour:02d}'
            blog_ev = blog_events_map.get(blog_key)
            participant_stats: Optional[dict] = None
            seats_left_male: Optional[int] = None
            seats_left_female: Optional[int] = None
            ev_location_detail: Optional[str] = None
            if blog_ev:
                participant_stats = blog_ev.get('participant_stats')
                seats_left_male = blog_ev.get('seats_left_male')
                seats_left_female = blog_ev.get('seats_left_female')
                # (나이X)코드가 이미 있으면 정본 — 블로그는 없을 때만 보충(collision 위험 있는
                # blog_key(월일시,연도없음)가 정본을 덮어쓰던 사고 방지, 2026-07-25).
                if age_range_min is None and blog_ev.get('age_range_min') is not None:
                    age_range_min = blog_ev['age_range_min']
                if age_range_max is None and blog_ev.get('age_range_max') is not None:
                    age_range_max = blog_ev['age_range_max']
                if blog_ev.get('age_group_label') and not age_group_label:
                    age_group_label = blog_ev['age_group_label']
                blog_location = blog_ev.get('location')
                if blog_location:
                    ev_location_detail = blog_location

            # 지역 결정은 공용 해석기로 일원화
            ev_region = resolve_region(
                region_phrase=_title_place(title_line),
                title=title_line,
                location_detail=ev_location_detail,
                body=description,
            )

            source_url = (
                f'{self.BASE_URL}/shop_view/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[에모셔널오렌지] {title_line}', 80)

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=ev_region,
                    location_detail=ev_location_detail,
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=theme,
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_group_label=age_group_label,
                    # 2026-07-25 오너 스샷 확인: "모든 소개팅 여성 연령 제한 없음"(상세정보
                    # 안내 이미지, 전 라인 공통 정책) — 그룹연령(A~G)은 남성 전용 기준이라
                    # 여성에 그대로 적용하면 안 됨.
                    age_male=_eo_age_disp(age_range_min, age_range_max),
                    age_female='제한 없음',
                    participant_stats=participant_stats,
                    description=description,
                ))
            except Exception:
                continue

        return events
