"""러브커뮤니티/Loco (lovecommunity.imweb.me) 스크래퍼 — imweb 기반, Playwright

상품 상세 페이지(/party/?idx=N)의 본문 텍스트에서 직접 파티 현황을 파싱합니다.
버튼 클릭 시 외부 사이트로 리디렉션되므로, 상세 페이지 텍스트 파싱만 사용합니다.

참가자 현황 형식 예시:
  🍷 01월 30일(금) 19:30~22:00 수원 ❤️
  남성🙆‍♂️ | 여성🙆‍♀️
  01호 해외영업(176) | 회사원(166)
  02호 회사원(180) | 마케팅(165)
  05호 모집중 | 모집중
  08호 모집중 | 모집중
"""
import re
import time
import json as _json
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month
from utils.region import resolve_region
from utils.imweb_options import gender_soldout_loco


class LovecommunityLoco(BaseScraper):
    # 상품 본문에서 가격을 직접 뽑음 → DB 기록.
    # (2026-07-25 발견: 플래그 없어 base_scraper가 매번 벗겨내 admin '해야할것'행)
    WRITES_PRICE = True
    # 예약위젯(gender_soldout_loco)이 성별 전 티켓 품절 여부를 정확히 준다 → 좌석도 기록.
    # (플래그가 없어 성별 마감 정보를 받아놓고도 저장 단계에서 벗겨지고 있었다 — 2026-07-29)
    WRITES_SEATS = True

    # 사이트에서 내려간 회차를 자동 정리한다. 전체 일정을 예약위젯 옵션에서
    # 안정적으로 뽑으므로 켜도 안전하다(부분 실패는 base_scraper 가 50% 룰로 막는다).
    # 껐을 땐 지난 회차·시각이 바뀐 중복이 계속 쌓여 같은 모임이 두 번 보였다
    # (2026-07-28: 연인어때 15건·로꼬 25건을 손으로 지움).
    DELETE_STALE = True

    BASE_URL = 'https://lovecommunity.imweb.me'
    SHOP_LIST_URL = 'https://lovecommunity.imweb.me/party'

    REGION_MAP = {
        '사당': '사당', '강남': '강남', '역삼': '강남', '압구정': '강남',
        '홍대': '홍대', '마포': '홍대', '신촌': '신촌',
        '수원': '수원', '수원시청': '수원',
        '인천': '인천', '성수': '성수', '건대': '건대',
    }

    # 날짜 패턴: "01/30(금)" 또는 "1월 30일" 형태
    DATE_SLASH_RE = re.compile(r'(\d{1,2})/(\d{1,2})\s*[\(\（]?[월화수목금토일][\)\）]?')
    DATE_KO_RE = re.compile(r'(\d{1,2})월\s*(\d{1,2})일')
    # 시간 패턴: "19:30~22:00"
    TIME_RE = re.compile(r'(\d{1,2}):(\d{2})')
    PRICE_RE = re.compile(r'([\d,]+)원')

    # 참가자 현황 파싱 패턴
    # "01호 해외영업(176) | 회사원(166)"
    # "01호 해외영업(176) | 모집중❤️"
    # "01호 모집중 | 모집중"
    PARTICIPANT_LINE_RE = re.compile(
        r'^(\d{2})호\s+'
        r'(.+?)(?:\((\d{2,3})\))?\s*\|\s*'
        r'(.+?)(?:\((\d{2,3})\))?[❤️\s]*$'
    )

    def __init__(self):
        super().__init__('lovecommunity-loco')

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                               'AppleWebKit/537.36 (KHTML, like Gecko) '
                               'Chrome/121.0.0.0 Safari/537.36',
                )
                page = context.new_page()

                # 1. /party 페이지에서 상품 idx 목록 수집
                # ⚠️(2026-09-05) 여기서 networkidle 을 못 기다리면 예외가 바깥 try 로 튀어
                #    크롤이 통째로 죽고 0건이 된다(에모셔널오렌지에서 실제로 그랬다).
                #    networkidle 은 «네트워크가 조용해졌나»일 뿐 화면이 비었다는 뜻이 아니다.
                page.goto(self.SHOP_LIST_URL, timeout=20000)
                try:
                    page.wait_for_load_state('networkidle', timeout=10000)
                except Exception:
                    self.logger.info('Loco 목록 페이지 로딩이 느려 기다리지 않고 진행')
                time.sleep(2)

                idxs = self._collect_product_idxs(page)
                self.logger.info(f'Loco 상품 {len(idxs)}개 발견')

                # 2. 각 상품 페이지 파싱 (/party/?idx=N 형식 사용)
                # ⚠️(2026-09-05) 상품 하나가 실패하면 조용히 빠져서 건수가 17건 → 7건으로
                #    널뛰었다(워치독이 이걸 '급락'으로 잡아 오탐 메일을 보냈다). 한 번은 다시
                #    해보고, 그래도 안 되면 몇 개를 놓쳤는지 로그에 남긴다.
                skipped: list[str] = []
                for idx in idxs:
                    product_url = f'{self.BASE_URL}/party/?idx={idx}'
                    try:
                        last_err = None
                        for attempt in (1, 2):
                            try:
                                page.goto(product_url, timeout=20000)
                                last_err = None
                                break
                            except Exception as e:
                                last_err = e
                                if attempt == 1:
                                    self.logger.warning(f'Loco idx={idx} 열기 실패 — 다시 시도: {e}')
                                    time.sleep(2)
                        if last_err is not None:
                            raise last_err
                        # ⚠️ networkidle 타임아웃으로 상품을 통째로 버리지 않는다. 광고·채팅
                        #    위젯이 계속 물려 있어 idx=4는 로컬에서도 매번 10초를 넘기는데,
                        #    예외가 그대로 올라가 그 상품 파싱 자체가 스킵되고 있었다.
                        try:
                            page.wait_for_load_state('networkidle', timeout=10000)
                        except Exception:
                            self.logger.debug(f'Loco idx={idx} networkidle 대기 초과(계속 진행)')
                        time.sleep(2)

                        # 현재 URL이 외부 사이트로 리디렉션됐는지 확인
                        current_url = page.url
                        if 'lovecommunity.imweb.me' not in current_url:
                            self.logger.warning(
                                f'Loco idx={idx} 외부 사이트로 리디렉션됨: {current_url}'
                            )
                            # 다시 직접 이동
                            page.goto(product_url, timeout=20000)
                            page.wait_for_load_state('domcontentloaded', timeout=10000)
                            time.sleep(1.5)

                        # 예약위젯(load_option.cm)에서 실제 가격 조회.
                        # ⚠️(2026-07-25 발견) 정적페이지 텍스트엔 진짜 가격이 없어(JS위젯
                        # 전용) price가 항상 None으로 저장돼 admin '해야할것'에 쌓이던 버그.
                        try:
                            widget = gender_soldout_loco(page, idx)
                        except Exception as e:
                            self.logger.warning(f'Loco idx={idx} 위젯 가격 조회 실패: {e}')
                            widget = {}

                        # ⚠️ 참가자 현황("🍷 8월 15일(토) 18:30~21:00 사당❤️")은 상세 본문이
                        #    다 그려진 뒤에야 DOM에 들어온다. networkidle + sleep(2)만으로는
                        #    그 전에 page.content()를 떠서 조용히 0건이 됐다 — 2026-08-14 실측:
                        #    같은 코드가 로컬에선 17건, Actions에선 8/12부터 계속 0건이었다.
                        #    날짜 헤더가 실제로 보일 때까지 명시적으로 기다린다.
                        try:
                            page.wait_for_function(
                                r"() => /🍷\s*\d{1,2}월\s*\d{1,2}일/.test(document.body.innerText)",
                                timeout=15000,
                            )
                        except Exception:
                            # 오픈 예정 상품처럼 원래 현황이 없는 경우도 있어 계속 진행한다.
                            self.logger.warning(f'Loco idx={idx} 참가자 현황이 안 떴다 — 그대로 파싱 시도')

                        soup = BeautifulSoup(page.content(), 'html.parser')
                        new_events = self._parse_product_page(soup, idx, widget)
                        events.extend(new_events)
                        self.logger.info(f'Loco idx={idx}: {len(new_events)}개 이벤트 파싱')
                    except Exception as e:
                        skipped.append(str(idx))
                        self.logger.warning(f'Loco 상품 idx={idx} 파싱 실패: {e}')

                if skipped:
                    self.logger.warning(
                        f'Loco 상품 {len(idxs)}개 중 {len(skipped)}개 못 가져옴 '
                        f'(idx={",".join(skipped)}) — 이만큼 일정이 빠집니다'
                    )

                browser.close()
        except Exception as e:
            self.logger.error(f'Loco 크롤링 실패: {e}')

        # 중복 제거
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
        self.logger.info(f'Loco 총 {len(filtered)}개 이벤트 (필터 전: {len(unique)}개)')
        return filtered

    def _collect_product_idxs(self, page) -> list[str]:
        """상품 목록 페이지에서 idx 수집 (party/?idx= 형식)"""
        idxs: list[str] = []
        try:
            links_data = page.eval_on_selector_all(
                'a[href*="party/?idx"], a[href*="party?idx"]',
                'els => els.map(e => e.href)',
            )
            for href in links_data:
                m = re.search(r'idx=(\d+)', href)
                if m and m.group(1) not in idxs:
                    idxs.append(m.group(1))
        except Exception as e:
            self.logger.warning(f'상품 목록 수집 실패: {e}')

        # fallback: shop_view 형식도 확인
        if not idxs:
            try:
                links_data = page.eval_on_selector_all(
                    'a[href*="shop_view"]',
                    'els => els.map(e => e.href)',
                )
                for href in links_data:
                    m = re.search(r'idx=(\d+)', href)
                    if m and m.group(1) not in idxs:
                        idxs.append(m.group(1))
            except Exception:
                pass

        return idxs

    def _parse_product_page(self, soup: BeautifulSoup, idx: str, widget: Optional[dict] = None) -> list[EventModel]:
        """
        상세 페이지 파싱.
        본문 텍스트에서 날짜별 파티 현황(참가자 목록)을 추출합니다.

        참가자 현황 블록 형식:
          🍷 01월 30일(금) 19:30~22:00 수원 ❤️    ← 날짜 헤더
          남성🙆‍♂️ | 여성🙆‍♀️                         ← 성별 헤더 (건너뜀)
          01호 해외영업(176) | 회사원(166)           ← 참가자 행
          02호 회사원(180) | 마케팅(165)
          ...
          05호 모집중 | 모집중❤️                     ← 모집중 = 잔여석
        """
        events: list[EventModel] = []
        text = soup.get_text(separator='\n', strip=True)
        current_year = datetime.now().year
        now = datetime.now()

        # 제목
        title_line = ''
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            title_line = og_title['content'].strip()
        if not title_line:
            h1 = soup.find('h1')
            if h1:
                title_line = h1.get_text(strip=True)

        # 썸네일
        thumbnail_url = None
        og_img = soup.find('meta', property='og:image')
        if og_img and og_img.get('content'):
            thumbnail_url = og_img['content']

        # 가격 — 상품 설명 텍스트에서
        prices = []
        for m in self.PRICE_RE.finditer(text[:3000]):
            val = int(m.group(1).replace(',', ''))
            if 10000 <= val <= 200000:
                prices.append(val)
        prices = sorted(set(prices))
        price_male = prices[0] if prices else None
        price_female = prices[0] if prices else None

        # 지역 추출 (공용 해석기)
        region = resolve_region(title=title_line, body=text[:2000])

        # 나이대 파싱 — JSON-LD description 우선
        age_min, age_max, age_group_label = None, None, None

        for script in soup.find_all('script', type='application/ld+json'):
            try:
                data = _json.loads(script.string or '')
                if data.get('@type') == 'Product':
                    desc = data.get('description', '')
                    m = re.search(
                        r'모집연령\s*:\s*(\d{2,4})년생\s*[~\-～]\s*(\d{2,4})년생',
                        desc,
                    )
                    if m:
                        y1, y2 = int(m.group(1)), int(m.group(2))
                        b1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                        b2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                        age_min = current_year - max(b1, b2)
                        age_max = current_year - min(b1, b2)
                        age_group_label = f'{m.group(1)}~{m.group(2)}년생'
                        break
            except Exception:
                pass

        # fallback: 텍스트에서 "🍷모집연령: 90년생 ~ 02년생" 패턴
        if age_min is None:
            age_m = re.search(
                r'모집연령\s*:\s*(\d{2,4})년생\s*[~\-～]\s*(\d{2,4})년생',
                text,
            )
            if age_m:
                y1 = int(age_m.group(1))
                y2 = int(age_m.group(2))
                b1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                b2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                age_min = current_year - max(b1, b2)
                age_max = current_year - min(b1, b2)
                age_group_label = f'{age_m.group(1)}~{age_m.group(2)}년생'

        # fallback2: "90년생~02년생" 텍스트
        if age_min is None:
            age_m = re.search(
                r'(\d{2,4})년생\s*[~\-～]\s*(\d{2,4})년생',
                text,
            )
            if age_m:
                y1, y2 = int(age_m.group(1)), int(age_m.group(2))
                b1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                b2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                age_min = current_year - max(b1, b2)
                age_max = current_year - min(b1, b2)
                age_group_label = f'{age_m.group(1)}~{age_m.group(2)}년생'

        # fallback3: "N세~N세" 직접 나이 표시
        if age_min is None:
            age_se_m = re.search(r'(\d{2})\s*세?\s*[~\-]\s*(\d{2})\s*세', text[:2000])
            if age_se_m:
                a1, a2 = int(age_se_m.group(1)), int(age_se_m.group(2))
                if 20 <= a1 <= 60 and 20 <= a2 <= 60:
                    age_min, age_max = min(a1, a2), max(a1, a2)

        # ──────────────────────────────────────────────────────────────
        # 날짜별 참가자 현황 블록 파싱
        # 형식:
        #   🍷 01월 30일(금) 19:30~22:00 수원 ❤️
        #   남성🙆‍♂️ | 여성🙆‍♀️
        #   01호 해외영업(176) | 회사원(166)
        #   ...
        #   05호 모집중 | 모집중❤️
        # ──────────────────────────────────────────────────────────────
        # 날짜 헤더 패턴: 🍷 + 날짜 + 시간
        DATE_HEADER_RE = re.compile(
            r'🍷\s*(\d{1,2})월\s*(\d{1,2})일.*?(\d{1,2}):(\d{2})'
        )
        # 참가자 행 패턴: "NN호 직업명(키) | 직업명(키)"
        # 모집중, 확인중❤️ 등도 허용
        SLOT_LINE_RE = re.compile(
            r'^(\d{2})호\s+'
            r'([\w가-힣\s\(\)]+?)(?:\((\d{2,3})\))?\s*\|\s*'
            r'([\w가-힣\s\(\)]+?)(?:\((\d{2,3})\))?'
            r'[❤️🙆‍♂️🙆‍♀️\s]*$'
        )

        lines = text.split('\n')
        seen_dates: set[str] = set()

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # 날짜 헤더 검출
            dh_m = DATE_HEADER_RE.search(line)
            if dh_m:
                mo = int(dh_m.group(1))
                d = int(dh_m.group(2))
                hour = int(dh_m.group(3))
                minute = int(dh_m.group(4))

                if hour < 10:
                    hour = 19

                try:
                    event_date = datetime(current_year, mo, d, hour, minute)
                    if event_date < now:
                        event_date = datetime(current_year + 1, mo, d, hour, minute)
                    if (event_date - now).days > 365:
                        i += 1
                        continue
                except ValueError:
                    i += 1
                    continue

                # 이 날짜 헤더 다음 라인에서 참가자 현황 수집
                male_participants = []
                female_participants = []
                i += 1  # 날짜 헤더 다음으로 이동

                while i < len(lines):
                    slot_line = lines[i].strip()

                    # 빈 줄이 2회 연속이거나 다음 날짜 헤더가 나오면 블록 종료
                    if DATE_HEADER_RE.search(slot_line):
                        break
                    if not slot_line:
                        i += 1
                        continue

                    # 성별 헤더 줄 건너뜀: "남성🙆‍♂️ | 여성🙆‍♀️"
                    if '남성' in slot_line and '여성' in slot_line:
                        i += 1
                        continue

                    # "XX호 ..." 형태 파싱
                    slot_m = re.match(
                        r'^(\d{2})호\s+(.+?)\s*\|\s*(.+)$',
                        slot_line
                    )
                    if slot_m:
                        slot_num = int(slot_m.group(1))
                        male_raw = slot_m.group(2).strip()
                        female_raw = slot_m.group(3).strip()

                        male_entry = self._parse_participant(male_raw)
                        female_entry = self._parse_participant(female_raw)

                        if male_entry is not None:
                            male_participants.append(male_entry)
                        if female_entry is not None:
                            female_participants.append(female_entry)

                        i += 1
                        continue

                    # 참가자 블록과 무관한 줄이 나오면 블록 종료
                    # (Loco History, separator 등)
                    if any(kw in slot_line for kw in [
                        'LOCO History', '커플 매칭', '모집인원', '모집연령',
                        '장소', '성비', '사당점', '로꼬 인스타', '실제 커플',
                    ]):
                        break

                    i += 1

                # 잔여석 계산: 모집중 항목 수
                seats_left_male = sum(
                    1 for p in male_participants if p.get('job') == '모집중'
                )
                seats_left_female = sum(
                    1 for p in female_participants if p.get('job') == '모집중'
                )

                # participant_stats 구성 (모집중 제외한 실제 참가자만)
                confirmed_male = [p for p in male_participants if p.get('job') != '모집중']
                confirmed_female = [p for p in female_participants if p.get('job') != '모집중']

                participant_stats: Optional[dict] = None
                if confirmed_male or confirmed_female or seats_left_male > 0 or seats_left_female > 0:
                    participant_stats = {
                        'male': confirmed_male,
                        'female': confirmed_female,
                        'seats_left_male': seats_left_male,
                        'seats_left_female': seats_left_female,
                    }

                date_key = f'{idx}_{event_date.strftime("%Y%m%d%H%M")}'
                if date_key in seen_dates:
                    continue
                seen_dates.add(date_key)

                # 테마
                theme = ['와인']
                if '커피' in title_line:
                    theme = ['커피']

                source_url = (
                    f'{self.BASE_URL}/party/?idx={idx}'
                    f'#evt={event_date.strftime("%Y%m%d%H%M")}'
                )
                title = sanitize_text(f'[로꼬] {title_line}', 80) or '[로꼬] 와인파티'

                # 예약위젯 가격이 있으면 정본으로 override(정적텍스트엔 진짜가격 없음)
                ev_price_male, ev_price_female = price_male, price_female
                wgd = (widget or {}).get((mo, d))
                w_male = w_female = None
                if wgd:
                    w_male, w_female = wgd.get('male'), wgd.get('female')
                    if w_male:
                        ev_price_male = w_male[0]
                    if w_female:
                        ev_price_female = w_female[0]

                # 성별 마감은 예약위젯이 정본(성별 전 티켓 품절 = 마감).
                # ⚠️ 위젯이 없을 때만 참가자 목록의 '모집중' 개수로 대체한다. 그 개수가
                #    0이라고 마감으로 단정하지 않는다(목록에 모집중 행이 안 뜰 수도 있음).
                #    예전엔 '0이면 None'이라 위젯이 마감이라고 알려줘도 앱엔 표시가 없었다.
                ev_seats_male = 0 if (w_male and w_male[1]) else (seats_left_male or None)
                ev_seats_female = 0 if (w_female and w_female[1]) else (seats_left_female or None)
                ev_closed = bool(w_male and w_male[1] and w_female and w_female[1])

                try:
                    events.append(EventModel(
                        title=title,
                        event_date=event_date,
                        location_region=region,
                        location_detail=None,
                        price_male=ev_price_male,
                        price_female=ev_price_female,
                        gender_ratio=None,
                        source_url=source_url,
                        thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                        theme=theme,
                        age_range_min=age_min,
                        age_range_max=age_max,
                        age_group_label=age_group_label,
                        age_male=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                        age_female=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                        seats_left_male=ev_seats_male,
                        seats_left_female=ev_seats_female,
                        is_closed=ev_closed,
                        participant_stats=participant_stats,
                    ))
                except Exception as e:
                    self.logger.warning(f'EventModel 생성 실패: {e}')
                    continue
            else:
                i += 1

        # 날짜 블록이 없는 경우 (사당 등) — 기존 방식 fallback
        if not events:
            events = self._parse_product_page_fallback(
                soup, idx, title_line, thumbnail_url, region,
                age_min, age_max, age_group_label, price_male, price_female,
                text, current_year, now, widget,
            )

        # ⚠️ 본문(참가자 현황)에는 모집이 시작된 회차만 실린다. 실제 신청 가능한 회차는
        #    예약위젯 옵션에 전부 들어 있는데(2026-07-28 실측: 옵션 6개 vs 본문 2개),
        #    본문만 보다 보니 8/7·8/8·8/15·8/16 이 앱에 아예 안 나왔다.
        #    옵션에만 있는 날짜를 여기서 보충한다.
        events.extend(self._events_from_widget_only(
            widget, {e.event_date for e in events}, idx, title_line, thumbnail_url,
            region, age_min, age_max, age_group_label, now,
        ))

        return events

    # 본문에 시각이 "7월 31일(금) 19:30~22:00" 처럼 적혀 있고 요일별로 고정이다.
    # 위젯 날짜 라벨('07/31(금)')엔 시각이 없어, 요일로 시각을 결정한다.
    WEEKDAY_HOUR = {4: (19, 30), 5: (18, 30), 6: (18, 30)}  # 금 / 토 / 일

    def _events_from_widget_only(self, widget, existing_dates, idx, title_line,
                                 thumbnail_url, region, age_min, age_max,
                                 age_group_label, now) -> list[EventModel]:
        """예약위젯 옵션에만 있고 본문엔 없는 회차를 이벤트로 만든다."""
        out: list[EventModel] = []
        if not widget:
            return out
        year = now.year
        for (mo, d), wgd in (widget or {}).items():
            try:
                # 연말·연초 경계: 지난 달로 나오면 내년으로 본다
                y = year + 1 if mo < now.month else year
                base = datetime(y, mo, d)
                hh, mm = self.WEEKDAY_HOUR.get(base.weekday(), (19, 30))
                dt = datetime(y, mo, d, hh, mm)
            except ValueError:
                continue
            if dt < now or any(abs((dt - e).total_seconds()) < 3600 * 6 for e in existing_dates):
                continue  # 지났거나 본문에서 이미 만든 회차(시각이 조금 달라도 같은 날)
            male, female = wgd.get('male'), wgd.get('female')
            if not male and not female:
                continue
            out.append(EventModel(
                title=sanitize_text(f'[로꼬] {title_line}', 80) or '[로꼬] 와인파티',
                event_date=dt,
                location_region=region,
                location_detail=None,
                price_male=male[0] if male else None,
                price_female=female[0] if female else None,
                gender_ratio=None,
                source_url=f'{self.BASE_URL}/party/?idx={idx}#evt={dt.strftime("%Y%m%d%H%M")}',
                thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                theme=['커피'] if '커피' in title_line else ['와인'],
                age_range_min=age_min,
                age_range_max=age_max,
                age_group_label=age_group_label,
                age_male=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                age_female=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                # 위젯에만 있는 회차 — 성별 품절도 위젯이 정본
                seats_left_male=0 if (male and male[1]) else None,
                seats_left_female=0 if (female and female[1]) else None,
                is_closed=bool(male and male[1] and female and female[1]),
            ))
        return out

    def _parse_participant(self, raw: str) -> Optional[dict]:
        """
        참가자 원시 문자열 파싱.
        "해외영업(176)" → {"job": "해외영업", "height": 176}
        "모집중❤️"     → {"job": "모집중"}
        "확인중❤️"     → None (확인중은 특수 상태)
        """
        # 이모지 및 앞뒤 공백 제거
        raw = re.sub(r'[❤️🙆‍♂️🙆‍♀️💕\s]+', ' ', raw).strip()
        raw = re.sub(r'\s+', ' ', raw).strip()

        if not raw or raw in ('', '-'):
            return None

        # 모집중
        if '모집중' in raw:
            return {'job': '모집중'}

        # 확인중 → None (아직 미정)
        if '확인중' in raw:
            return None

        # 직업명(키) 형태
        height_m = re.search(r'\((\d{2,3})\)', raw)
        if height_m:
            height = int(height_m.group(1))
            job = raw[:height_m.start()].strip()
            if job:
                return {'job': job, 'height': height}

        # 키 없이 직업명만
        if raw:
            return {'job': raw}

        return None

    def _parse_product_page_fallback(
        self,
        soup: BeautifulSoup,
        idx: str,
        title_line: str,
        thumbnail_url: Optional[str],
        region: str,
        age_min: Optional[int],
        age_max: Optional[int],
        age_group_label: Optional[str],
        price_male: Optional[int],
        price_female: Optional[int],
        text: str,
        current_year: int,
        now: datetime,
        widget: Optional[dict] = None,
    ) -> list[EventModel]:
        """
        날짜별 참가자 현황 블록이 없는 경우의 fallback 파싱.
        날짜 패턴만 찾아 기본 이벤트를 생성합니다.
        """
        widget = widget or {}
        events: list[EventModel] = []
        seen_dates: set[str] = set()

        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            if line.startswith('[옵션]'):
                continue

            mo, d = None, None

            slash_m = self.DATE_SLASH_RE.search(line)
            if slash_m:
                mo = int(slash_m.group(1))
                d = int(slash_m.group(2))

            if mo is None:
                ko_m = self.DATE_KO_RE.search(line)
                if ko_m:
                    mo = int(ko_m.group(1))
                    d = int(ko_m.group(2))

            if mo is None or not (1 <= mo <= 12 and 1 <= d <= 31):
                continue

            hour, minute = 19, 0
            time_m = self.TIME_RE.search(line)
            if time_m:
                hour = int(time_m.group(1))
                minute = int(time_m.group(2))
                if hour < 10:
                    hour, minute = 19, 0

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

            theme = ['와인']
            if '커피' in title_line or '커피' in line:
                theme = ['커피']

            source_url = (
                f'{self.BASE_URL}/party/?idx={idx}'
                f'#evt={event_date.strftime("%Y%m%d%H%M")}'
            )
            title = sanitize_text(f'[로꼬] {title_line}', 80) or '[로꼬] 와인파티'

            # 예약위젯 가격이 있으면 정본으로 override(정적텍스트엔 진짜가격 없음)
            ev_price_male, ev_price_female = price_male, price_female
            wgd = (widget or {}).get((mo, d))
            if wgd:
                if wgd.get('male'):
                    ev_price_male = wgd['male'][0]
                if wgd.get('female'):
                    ev_price_female = wgd['female'][0]

            try:
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=ev_price_male,
                    price_female=ev_price_female,
                    gender_ratio=None,
                    source_url=source_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=theme,
                    age_range_min=age_min,
                    age_range_max=age_max,
                    age_group_label=age_group_label,
                    age_male=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                    age_female=(f'{age_min}~{age_max}' if age_min is not None and age_max is not None else None),
                    seats_left_male=None,
                    seats_left_female=None,
                    participant_stats=None,
                ))
            except Exception:
                continue

        return events
