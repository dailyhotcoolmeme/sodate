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
from datetime import datetime, timezone
from typing import Optional

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

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


class MuntoScraper(BaseScraper):
    def __init__(self):
        super().__init__('munto')

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []

        try:
            with httpx.Client(headers=API_HEADERS, follow_redirects=True) as client:
                # 연애·사랑 카테고리 소셜링 목록 (최대 30개)
                list_data = _get(
                    client,
                    f'{MUNTO_API_BASE}/socialing/section',
                    params={'type': 'default', 'categoryId': DATING_CATEGORY_ID, 'limit': 30}
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
                        if start_date_str:
                            try:
                                event_date = datetime.fromisoformat(
                                    start_date_str.replace('Z', '+00:00')
                                ).astimezone().replace(tzinfo=None)
                            except Exception:
                                event_date = datetime.now().replace(hour=19, minute=0, second=0, microsecond=0)
                        else:
                            event_date = datetime.now().replace(hour=19, minute=0, second=0, microsecond=0)

                        # 미래 이벤트만
                        if event_date < datetime.now():
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

                        # 나이 범위
                        introduce = detail.get('introduce', '') or ''
                        age_range_min_det = detail.get('minAge')
                        age_range_max_det = detail.get('maxAge')

                        # 이름/소개에서 나이 범위 추출 (API에 없는 경우 보완)
                        age_min_text, age_max_text, age_label = _parse_age_range(name + ' ' + introduce[:200])
                        age_range_min = age_range_min_det if age_range_min_det else age_min_text
                        age_range_max = age_range_max_det if age_range_max_det else age_max_text
                        age_group_label = age_label

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
                            description=sanitize_text(introduce, 500) if introduce else None,
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
        self.logger.info(f'문토 총 {len(unique)}개 이벤트 수집 완료')
        return unique
