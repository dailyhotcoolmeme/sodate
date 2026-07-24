"""문토 (www.munto.kr) 스크래퍼 — Playwright + 공개 API 기반

동작 방식:
1. www.munto.kr 기반 API (api.munto.kr) 를 통해 연애·사랑 카테고리(id=12) 소셜링 목록 수집
2. 각 소셜링 상세 API (/api/web/v1/socialing/{id}) 로 세부 정보 수집
3. 승인 멤버 API (/api/web/v1/socialing/{id}/members?status=APPROVE) 로 참가자 현황 수집
4. recruitAnswer 필드에서 나이/키/직업 파싱

참고: munto.kr 도메인은 A 레코드가 없으므로 www.munto.kr 사용
"""

import re
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

# base_scraper가 naive datetime을 KST 벽시계로 간주하므로, 여기서도 KST로 명시 변환한다.
# (실행 머신 TZ에 의존하는 .astimezone() → GitHub Actions(UTC)에서 -9h 버그 방지)
KST = timezone(timedelta(hours=9))

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month

MUNTO_BASE_URL = 'https://www.munto.kr'
MUNTO_API_BASE = 'https://api.munto.kr/api/web/v1'

# 연애·사랑 카테고리 ID (소개팅/미팅 포함)
DATING_CATEGORY_ID = 12

# 소개팅 관련 키워드 (제목/태그 필터링용)
DATING_KEYWORDS = ['소개팅', '미팅', '로테이션', '만남살롱', '커플', '썸', '솔로', '매칭']

DATE_RE = re.compile(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})')
PRICE_RE = re.compile(r'([\d,]+)\s*원')
AGE_RANGE_RE = re.compile(
    r'([89]\d|0\d)[-~]([89]\d|0\d)년?생?|'  # 92-00년생, 89~95년생 (년생 패턴)
    r'(\d{2})대\s*(?:~|[-])\s*(\d{2})대|'    # 20대~30대
    r'(\d{2})\s*[-~]\s*(\d{2})\s*(?:살|세)'  # 25~35살, 21-31세
)
HEIGHT_RE = re.compile(r'(1[5-9]\d|2[0-1]\d)\s*cm?', re.I)
BIRTH_YEAR_RE = re.compile(
    r'(19\d{2}|20\d{2})년?생?|'   # 1996년생, 2001년
    r'\b([9][0-9]|0[0-9])년생?\b'  # 96년생, 02년생
)

REGION_KW = [
    '강남', '홍대', '신촌', '잠실', '건대', '성수', '이태원', '합정',
    '여의도', '수원', '인천', '부산', '대구', '대전', '마포', '종로',
    '망원', '신림', '영등포', '광진', '송파', '용산',
]

API_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json',
    'Referer': 'https://www.munto.kr/',
    'Origin': 'https://www.munto.kr',
}


def _get(client: httpx.Client, url: str, **kwargs) -> Optional[dict]:
    """GET 요청 후 JSON 반환. 실패 시 None."""
    try:
        resp = client.get(url, timeout=15, **kwargs)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None


def _parse_recruit_answer(answer: str) -> dict:
    """
    recruitAnswer 텍스트에서 나이, 키, 직업 정보 파싱.

    입력 예시:
    - "나우\n여\n1996년생\n173\n외국계 제약사\n잘웃음"
    - "현성 / 남성 / 97년생 / 178cm / 항공사 경영관리직"
    - "돈까스/여자/97/168/마케터"
    """
    if not answer or len(answer) < 4:
        return {}

    result: dict = {}

    # 구분자(/, 줄바꿈)로 분리 후 정리
    # 번호 접두사 제거 (1., 2. 등)
    cleaned = re.sub(r'^\s*\d+[.)]\s*', '', answer, flags=re.MULTILINE)
    parts = [p.strip() for p in re.split(r'[\n/]', cleaned) if p.strip()]

    # 출생연도 / 나이 추출
    year_m = re.search(
        r'(19\d{2}|20\d{2})년?생?|'
        r'\b([9][0-9]|0[0-9])년생?\b|'
        r'(\d{2})년생',
        answer
    )
    if year_m:
        raw = year_m.group(1) or year_m.group(2) or year_m.group(3)
        if raw and len(raw) == 2:
            raw = '20' + raw if int(raw) <= 10 else '19' + raw
        if raw:
            try:
                birth_year = int(raw)
                result['birth_year'] = birth_year
                result['generation'] = str(birth_year)[2:]  # "96"
            except ValueError:
                pass

    # 키 추출
    height_m = HEIGHT_RE.search(answer)
    if height_m:
        result['height'] = int(height_m.group(1))
    else:
        # 숫자만 있는 파트에서 150~210 범위 탐색
        for part in parts:
            nums = re.findall(r'\b(1[5-9]\d|2[0-1]\d)\b', part)
            if nums:
                result['height'] = int(nums[0])
                break

    # 직업 추출 — 성별/나이/키와 무관한 파트 중 텍스트가 있는 첫 번째
    skip_patterns = [
        r'^[남녀여]',        # 성별
        r'^\d+',             # 숫자로 시작 (나이, 키)
        r'^[ㄱ-ㅎ]+$',       # 자음만
        r'^[ㅡㅇ]+$',        # 무의미한 텍스트
        r'^\d{2,4}년',       # 년생
    ]
    for part in parts[2:]:  # 앞 2개(이름, 성별)는 건너뜀
        skip = any(re.match(pat, part) for pat in skip_patterns)
        if not skip and len(part) >= 3:
            # 키/나이로 보이는 숫자 파트 제외
            if not re.match(r'^\d{2,3}$', part):
                result['job'] = part[:40]
                break

    return result


def _parse_age_range(text: str) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """
    텍스트에서 나이 범위 추출.
    반환: (age_min, age_max, label)
    label 예: "92~00년생", "25~35세"

    판별 기준:
    - 년생 패턴: 숫자가 80~99 또는 00~09 + "년생" 키워드 또는 이름에 명시
    - 살/세 패턴: "살", "세" 접미사
    - 이름에 나이범위: 20~50 사이 숫자 조합이면 나이로 해석
    """
    label = None

    # 1순위: 년생 패턴 (89~00년생 등 명확한 패턴)
    birth_m = re.search(r'([89]\d|0\d)\s*[-~]\s*([89]\d|0\d)\s*년?생?', text)
    if birth_m:
        label = birth_m.group(0)
        current_year = datetime.now().year
        start_yy, end_yy = int(birth_m.group(1)), int(birth_m.group(2))
        start_year = (2000 + start_yy) if start_yy <= 10 else (1900 + start_yy)
        end_year = (2000 + end_yy) if end_yy <= 10 else (1900 + end_yy)
        if start_year > end_year:
            start_year, end_year = end_year, start_year
        age_min = current_year - end_year
        age_max = current_year - start_year
        return age_min, age_max, label

    # 2순위: 살/세 패턴
    age_m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*(?:살|세)', text)
    if age_m:
        label = age_m.group(0)
        age_min = int(age_m.group(1))
        age_max = int(age_m.group(2))
        if age_min > age_max:
            age_min, age_max = age_max, age_min
        return age_min, age_max, label

    # 3순위: "21-31", "25~45" 형태 (나이처럼 보이는 숫자 조합)
    range_m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})(?!\s*년)', text)
    if range_m:
        a, b = int(range_m.group(1)), int(range_m.group(2))
        # 나이 범위(17~60)로 보이는 경우만
        if 17 <= a <= 60 and 17 <= b <= 60:
            label = range_m.group(0)
            age_min, age_max = (a, b) if a <= b else (b, a)
            return age_min, age_max, label

    return None, None, None


def _extract_region(text: str, location_field: str = '') -> str:
    """지역 추출."""
    combined = location_field + ' ' + text
    for r in REGION_KW:
        if r in combined:
            return r
    return location_field.split()[0] if location_field else '서울'


def _build_participant_stats(
    members: list[dict],
    male_max: int,
    female_max: int,
    male_current: int,
    female_current: int,
) -> dict:
    """
    members 리스트에서 participant_stats dict 생성.
    host 제외, 성별 분류, recruitAnswer 파싱.
    """
    male_list = []
    female_list = []

    for m in members:
        if m.get('isHost'):
            continue
        sex = m.get('sex', '')
        answer = m.get('recruitAnswer', '') or ''
        parsed = _parse_recruit_answer(answer)

        entry: dict = {}
        if parsed.get('generation'):
            entry['generation'] = parsed['generation']
        if parsed.get('job'):
            entry['job'] = parsed['job']
        if parsed.get('height'):
            entry['height'] = parsed['height']

        if sex == 'MALE':
            male_list.append(entry)
        elif sex == 'FEMALE':
            female_list.append(entry)

    # 잔여석 계산
    seats_left_male = None
    seats_left_female = None
    capacity_male = None
    capacity_female = None

    if male_max and male_max > 0:
        capacity_male = male_max
        seats_left_male = max(0, male_max - male_current)

    if female_max and female_max > 0:
        capacity_female = female_max
        seats_left_female = max(0, female_max - female_current)

    stats: dict = {}
    if male_list:
        stats['male'] = male_list
    if female_list:
        stats['female'] = female_list
    if seats_left_male is not None:
        stats['seats_left_male'] = seats_left_male
    if seats_left_female is not None:
        stats['seats_left_female'] = seats_left_female

    return stats, capacity_male, capacity_female, seats_left_male, seats_left_female


def _munto_age_disp(mn: Optional[int], mx: Optional[int]) -> Optional[str]:
    """age_range → 앱 성별 나이 표시 문자열(만나이)."""
    if mn is not None and mx is not None:
        return f'{mn}~{mx}'
    if mx is not None:
        return f'~{mx}'
    if mn is not None:
        return f'{mn}~'
    return None


def _yy_to_age(yy: int, cur_year: int) -> int:
    """두자리 출생연도 → 만나이. yy<=15는 2000년대, 그외 1900년대."""
    year = (2000 + yy) if yy <= 15 else (1900 + yy)
    return cur_year - year


def _to_age_range(a: int, b: int, is_born: bool, cur_year: int) -> tuple[int, int]:
    """(a,b) → 만나이 (lo,hi). is_born이면 년생→만나이 변환."""
    if is_born:
        x, y = _yy_to_age(a, cur_year), _yy_to_age(b, cur_year)
        return (min(x, y), max(x, y))
    return (a, b) if a <= b else (b, a)


def _munto_label_age(text: str, sex_sym: str) -> Optional[tuple]:
    """성별 마커(🙋‍♂️/♀ 등 ♂/♀) 기준 나이(가장 명시적).
    (a) '♂ … 나이: 26-34세' / '나이제한x'.  (b) '♂남성\\n-25~36세'(나이: 없이 마커 뒤 범위).
    날짜줄('7.11 (토) (23~36세)')은 성별마커가 없어 안 걸림. ('range',lo,hi)/('unlimited',)/None."""
    def ok(a, b):
        lo, hi = (a, b) if a <= b else (b, a)
        return (lo, hi) if (17 <= lo <= 60 and 17 <= hi <= 60) else None
    # (a) '나이:' 라벨
    m = re.search(sex_sym + r'️?[^\n]{0,4}나이\s*[:：]\s*([^\n]{0,24})', text)
    if m:
        val = m.group(1)
        if re.search(r'나이\s*제한\s*[xX✕❌]|제한\s*없음|제한\s*x', val):
            return ('unlimited',)
        r = re.search(r'(\d{2})\s*[~\-]\s*(\d{2})', val)
        if r and ok(int(r.group(1)), int(r.group(2))):
            lo, hi = ok(int(r.group(1)), int(r.group(2)))
            return ('range', lo, hi)
    # (b) 마커 뒤(같은/다음 줄) 곧바로 'NN~NN세'
    m = re.search(sex_sym + r'️?[^\n]{0,6}\n?\s*[-~]?\s*(\d{2})\s*[~\-]\s*(\d{2})\s*세', text)
    if m and ok(int(m.group(1)), int(m.group(2))):
        lo, hi = ok(int(m.group(1)), int(m.group(2)))
        return ('range', lo, hi)
    return None


def _munto_inline_ages(text: str, gchar: str, cur_year: int) -> list[tuple[int, int]]:
    """'남29~36'·'남 00~92년생'·'남 : 95-02년생' 등 인라인 성별 범위.
    '남성기준'(성이 뒤따름)·키('남178')·프로필('남 182')은 자동 제외(범위 ~/- 필수).
    반환: 발견된 만나이범위 리스트(여러 조 존재 판정용)."""
    out = []
    for m in re.finditer(gchar + r'\s*[:：)]?\s*(\d{2})\s*[~\-]\s*(\d{2})\s*(년생?)?', text):
        a, b = int(m.group(1)), int(m.group(2))
        born = bool(m.group(3)) or (min(a, b) <= 16 or max(a, b) >= 55)
        lo, hi = _to_age_range(a, b, born, cur_year)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            out.append((lo, hi))
    return out


def _munto_common_age(text: str, cur_year: int) -> Optional[tuple]:
    """공통(남녀동일) 나이 기준 → ('range',lo,hi)/('lower',lo)/('upper',hi)/None.
    ※ 'N년생 이하'는 오너 규칙상 상한('~N세')으로 표시(만나이로 변환). '이상'은 하한('N세~').
       '나이제한❌' 같은 본문 주석은 무제한 처리하지 않는다(제목 나이로 fallback시킴)."""
    m = re.search(r'(\d{2})\s*년\s*생?\s*이하', text)  # 'N년생 이하' → 만나이 상한 '~N세'
    if m:
        yy = int(m.group(1)); yr = (2000 + yy) if yy <= 15 else (1900 + yy)
        return ('upper', cur_year - yr)
    m = re.search(r'(\d{2})\s*년\s*생?\s*이상', text)  # 'N년생 이상' → 만나이 하한 'N세~'
    if m:
        yy = int(m.group(1)); yr = (2000 + yy) if yy <= 15 else (1900 + yy)
        return ('lower', cur_year - yr)
    kor = re.search(r'한국\s*나이\s*(\d{2})\s*[-~]\s*(\d{2})', text)  # 한국나이→만(-1)
    if kor:
        a, b = int(kor.group(1)) - 1, int(kor.group(2)) - 1
        lo, hi = (a, b) if a <= b else (b, a)
        return ('range', lo, hi)
    m = re.search(r'모집\s*나이\s*[:：]?\s*(\d{2})\s*[-~]\s*(\d{2})\s*(년생?|세)?', text)
    if m:
        a, b, unit = int(m.group(1)), int(m.group(2)), m.group(3)
        born = bool(unit and '년' in unit) or (min(a, b) <= 16 or max(a, b) >= 55)
        lo, hi = _to_age_range(a, b, born, cur_year)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            return ('range', lo, hi)
    # ⚠️(2026-07-25) '모집 나이:' 라벨 없이 "남성, 여성 : 90-99년생"처럼 그냥 년생
    # 범위만 적힌 경우가 많아(213건 확대 후 다수 발견) 낮은 우선순위 폴백으로 추가.
    m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*년\s*생', text)
    if m:
        lo, hi = _to_age_range(int(m.group(1)), int(m.group(2)), True, cur_year)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            return ('range', lo, hi)
    return None


def _munto_title_age(name: str, cur_year: int) -> Optional[tuple[int, int]]:
    """제목의 명시 나이(마지막 fallback). '(89-96년생)'·'37-45세'·'28-37'·'[90-02]' → (lo,hi) 만나이."""
    t = re.sub(r'[～〜∼]', '~', name)
    m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*년', t)  # 년생 표기 우선
    if m:
        lo, hi = _to_age_range(int(m.group(1)), int(m.group(2)), True, cur_year)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            return (lo, hi)
    # 대괄호 안 'NN-NN'(예: '[90-02]')는 표기 관례상 년생 범위
    m = re.search(r'\[\s*(\d{2})\s*[-~]\s*(\d{2})\s*\]', t)
    if m:
        lo, hi = _to_age_range(int(m.group(1)), int(m.group(2)), True, cur_year)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            return (lo, hi)
    m = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*세?', t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        lo, hi = (a, b) if a <= b else (b, a)
        if 17 <= lo <= 60 and 17 <= hi <= 60:
            return (lo, hi)
    return None


def _munto_resolve_ages(name: str, introduce: str, cur_year: int) -> tuple:
    """문토 성별 나이 종합 해석.
    우선순위: 🙋라벨 > 인라인 남/여범위 > (모호시 제목) > 공통 모집기준 > 제목 fallback.
    반환: (age_male_disp, age_female_disp, range_min, range_max, note)."""
    text = re.sub(r'[～〜∼]', '~', (name + '\n' + introduce)).replace('–', '-').replace('—', '-')
    note = []

    def gender_state(gchar, sym):
        lab = _munto_label_age(text, sym)
        if lab:
            return ('unlimited', None, None) if lab[0] == 'unlimited' else ('range', lab[1], lab[2])
        distinct = sorted(set(_munto_inline_ages(text, gchar, cur_year)))
        if len(distinct) == 1:
            return ('range', distinct[0][0], distinct[0][1])
        if len(distinct) > 1:
            return ('ambiguous', None, None)  # 여러 조 → 제목으로 확정
        return (None, None, None)

    male = gender_state('남', '♂')
    female = gender_state('여', '♀')
    undef = (None, 'ambiguous')

    if male[0] in undef and female[0] in undef:
        # per-gender 없음/모호 → 공통 기준(본문) 또는 제목
        common = _munto_common_age(introduce, cur_year)
        if common:
            if common[0] == 'unlimited':
                male = female = ('unlimited', None, None)
            elif common[0] == 'range':
                male = female = ('range', common[1], common[2])
            elif common[0] == 'lower':
                male = female = ('lower', common[1], None)
            elif common[0] == 'upper':
                male = female = ('upper', None, common[1])
        else:
            t = _munto_title_age(name, cur_year)
            if t:
                male = female = ('range', t[0], t[1]); note.append('제목fallback')
    else:
        # 한쪽만 없음/모호 → 다른 성별 값 복사(둘 다 표시되도록)
        if male[0] in undef:
            male = female
        if female[0] in undef:
            female = male

    def disp(st):
        k, lo, hi = st
        return {'range': f'{lo}~{hi}', 'lower': f'{lo}세~', 'upper': f'~{hi}세',
                'unlimited': '제한 없음'}.get(k)

    def bounds(st):
        k, lo, hi = st
        if k == 'range': return (lo, hi)
        if k == 'lower': return (lo, None)
        if k == 'upper': return (None, hi)
        if k == 'unlimited': return (None, None)
        return None

    age_male_disp, age_female_disp = disp(male), disp(female)
    bs = [b for b in (bounds(male), bounds(female)) if b is not None]
    if not bs:
        return age_male_disp, age_female_disp, None, None, ';'.join(note)
    los = [b[0] for b in bs]; his = [b[1] for b in bs]
    range_min = None if any(x is None for x in los) else min(los)
    range_max = None if any(x is None for x in his) else max(his)
    return age_male_disp, age_female_disp, range_min, range_max, ';'.join(note)


class MuntoScraper(BaseScraper):
    # munto API에서 단일가격(남녀 동일)·정원-인원 좌석을 뽑음 → DB 기록
    WRITES_PRICE = True
    WRITES_SEATS = True
    # 나이 정본 — 근거 없으면 None으로 기록해 옛 잘못된 나이를 지운다(652320 등)
    WRITES_AGE = True
    # 현재 API 목록에 없는 옛 socialing(가격 없던 구데이터) 정리
    DELETE_STALE = True

    def __init__(self):
        super().__init__('munto')

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []

        try:
            with httpx.Client(headers=API_HEADERS, follow_redirects=True) as client:
                # 연애·사랑 카테고리 소셜링 목록. ⚠️예전 limit=30은 인위적 상한이라
                # 실제 활성 리스팅(235건 확인, 2026-07-24)의 앞 30개만 가져오고 나머지
                # (및 거기 딸린 더 먼 미래 날짜)를 통째로 놓치고 있었음. 여유있게 상향.
                list_data = _get(
                    client,
                    f'{MUNTO_API_BASE}/socialing/section',
                    params={'type': 'default', 'categoryId': DATING_CATEGORY_ID, 'limit': 300}
                )
                if not list_data:
                    self.logger.error('문토 목록 API 응답 없음')
                    return events

                socialings = list_data.get('socialings', [])
                self.logger.info(f'문토 연애·사랑 카테고리 소셜링 {len(socialings)}개 발견')

                for item in socialings:
                    try:
                        name = item.get('name', '')
                        # 소개팅 관련 이벤트만 필터
                        tags = item.get('tags', [])
                        tag_names = [t if isinstance(t, str) else t.get('name', '') for t in tags]
                        all_text = name + ' '.join(tag_names)
                        if not any(kw in all_text for kw in DATING_KEYWORDS):
                            continue

                        socialing_id = item.get('id')
                        if not socialing_id:
                            continue

                        # 상세 API 조회
                        detail = _get(client, f'{MUNTO_API_BASE}/socialing/{socialing_id}')
                        if not detail:
                            self.logger.warning(f'문토 상세 조회 실패: {socialing_id}')
                            continue

                        time.sleep(0.5)  # API 부하 방지

                        # 승인된 멤버 목록 조회
                        members_data = _get(
                            client,
                            f'{MUNTO_API_BASE}/socialing/{socialing_id}/members',
                            params={'status': 'APPROVE'}
                        )
                        members = members_data.get('members', []) if members_data else []

                        # --- 기본 정보 ---
                        title = sanitize_text(f'[문토] {name}', 80)

                        # 날짜
                        start_date_str = detail.get('startDate') or item.get('startDate')
                        now_kst = datetime.now(KST).replace(tzinfo=None)
                        if start_date_str:
                            try:
                                # KST(UTC+9)로 명시 변환 후 naive KST 벽시계로 넘긴다.
                                event_date = datetime.fromisoformat(
                                    start_date_str.replace('Z', '+00:00')
                                ).astimezone(KST).replace(tzinfo=None)
                            except Exception:
                                event_date = now_kst.replace(hour=19, minute=0, second=0, microsecond=0)
                        else:
                            event_date = now_kst.replace(hour=19, minute=0, second=0, microsecond=0)

                        # 미래 이벤트만 (KST 기준으로 비교)
                        if event_date < now_kst:
                            continue

                        # 가격 (단일 가격 — 남녀 구분 없음)
                        price = detail.get('price')
                        price_male = int(price) if price else None
                        price_female = price_male  # 문토는 남녀 동일가격

                        # 지역
                        location_raw = detail.get('location') or item.get('location', '')
                        social_loc = detail.get('socialingLocation') or {}
                        addr = social_loc.get('addressName', '') or social_loc.get('roadmapAddress', '')
                        region = _extract_region(addr + ' ' + name, location_raw)

                        # 상세 위치
                        place_name = social_loc.get('placeName', '') or None

                        # 썸네일
                        covers = detail.get('covers') or item.get('covers', [])
                        if not covers:
                            cover = detail.get('cover') or item.get('cover')
                            covers = [cover] if cover else []
                        thumbnails = [u for u in covers if u and not u.endswith('.svg')][:5]

                        # 나이 — 문토는 성별로 다름(남/여 각각 만나이). 라벨>인라인>공통>제목 순.
                        # 한쪽경계는 'N세~'(하한)/'~N세'(상한), 무제한은 '제한 없음'. 텍스트 없으면 공란.
                        # 본문(성별/공통) → 제목 순. 근거 없으면 공란(None). API min/max는 신뢰 안 함(오너 확정).
                        introduce = detail.get('introduce', '') or ''
                        age_male_disp, age_female_disp, age_range_min, age_range_max, _agenote = \
                            _munto_resolve_ages(name, introduce, now_kst.year)
                        age_group_label = None

                        # 참가자 현황
                        male_max = detail.get('maleMaximumCount') or 0
                        female_max = detail.get('femaleMaximumCount') or 0
                        male_current = detail.get('maleCurrentCount') or 0
                        female_current = detail.get('femaleCurrentCount') or 0

                        participant_stats, capacity_male, capacity_female, seats_left_male, seats_left_female = \
                            _build_participant_stats(
                                members,
                                male_max, female_max,
                                male_current, female_current
                            )

                        # participant_stats가 비어있어도 현재 인원은 기록
                        if not participant_stats.get('male') and male_current > 0:
                            participant_stats['male_count'] = male_current
                        if not participant_stats.get('female') and female_current > 0:
                            participant_stats['female_count'] = female_current

                        # 마감 여부
                        status = detail.get('status', '')
                        is_closed = status in ('CLOSED', 'CONFIRM', 'CANCEL') or detail.get('stopRecruit', False)

                        # 포맷
                        category_tag = detail.get('categoryTag', {}) or {}
                        tag_name = category_tag.get('name', '')
                        fmt = '로테이션' if '로테이션' in tag_name else '소개팅'

                        source_url = f'{MUNTO_BASE_URL}/ko/socialing?id={socialing_id}'

                        events.append(EventModel(
                            external_id=f'munto_{socialing_id}',
                            title=title,
                            description=sanitize_text(introduce, 6000) if introduce else None,
                            thumbnail_urls=thumbnails,
                            event_date=event_date,
                            location_region=region,
                            location_detail=place_name,
                            price_male=price_male,
                            price_female=price_female,
                            gender_ratio=f'{male_current}:{female_current}' if male_current or female_current else None,
                            capacity_male=capacity_male,
                            capacity_female=capacity_female,
                            seats_left_male=seats_left_male,
                            seats_left_female=seats_left_female,
                            theme=['소개팅'],
                            age_range_min=age_range_min,
                            age_range_max=age_range_max,
                            age_male=age_male_disp,
                            age_female=age_female_disp,
                            format=fmt,
                            age_group_label=age_group_label,
                            participant_stats=participant_stats if participant_stats else None,
                            source_url=source_url,
                            is_closed=is_closed,
                        ))

                        self.logger.debug(
                            f'문토 이벤트 수집: {socialing_id} | {name[:40]} | '
                            f'남{male_current}/{male_max} 여{female_current}/{female_max}'
                        )
                        time.sleep(0.3)

                    except Exception as e:
                        self.logger.warning(f'문토 이벤트 파싱 실패 id={item.get("id")}: {e}')

        except Exception as e:
            self.logger.error(f'문토 크롤링 실패: {e}')

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
        self.logger.info(f'문토 총 {len(filtered)}개 이벤트 수집 완료 (필터 전: {len(unique)}개)')
        return filtered
