"""이연시 (2yeonsi.com) 스크래퍼 — 광주 7:7 소개팅, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

# 3/28(토) 15:00 2F（ 낮 134기 95-02년생 ）*여2자리남음
DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})[（(][월화수목금토일][）)]\s*(\d{1,2}):(\d{2})')
CLOSED_RE = re.compile(r'모집종료|양쪽마감|남자마감.*여자마감|여자마감.*남자마감')

# 가격 파싱: "남 : 7만원" / "남 : 70,000원"
PRICE_MALE_RE = re.compile(r'남\s*[:\-]\s*(\d+)\s*만원|남\s*[:\-]\s*([\d,]+)\s*원')
PRICE_FEMALE_RE = re.compile(r'여\s*[:\-]\s*(\d+)\s*만원|여\s*[:\-]\s*([\d,]+)\s*원')

# 나이대: "95-02년생", "1995~2002년생"
AGE_LABEL_RE = re.compile(r'(\d{2,4}[-~]\d{2,4}년생)')

# 잔여석: "ㅡ ㅡ N 자리 남았습니다"
SEATS_RE = re.compile(r'[ㅡ\-\s]+(\d+)\s*자리\s*남았')

# 참가자 현황: 슬래시 구분 생년 목록 (예: 97/95/95/95)
BIRTH_LIST_RE = re.compile(r'(\d{2}(?:/\d{2}){2,})')
# 직업 목록 (예: 공무원/프리랜서/대기업)
JOB_LIST_RE = re.compile(r'([가-힣]{2,6}(?:/[가-힣]{2,6}){2,})')


class TwoYeonsiScraper(BaseScraper):
    LIST_URL = 'https://2yeonsi.com/?idx=c66d7a938c66fb'
    BASE_URL = 'https://2yeonsi.com'

    def __init__(self):
        super().__init__('twoyeonsi')

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
                page.goto(self.LIST_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(3)

                # 스크롤해서 전체 로드
                page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                time.sleep(2)

                soup = BeautifulSoup(page.content(), 'html.parser')
                text = soup.get_text(separator='\n', strip=True)
                lines = [l.strip() for l in text.split('\n') if l.strip()]

                now = datetime.now()
                current_year = now.year
                seen: set[str] = set()

                # 전체 텍스트에서 가격 파싱 (페이지 공통)
                full_text = '\n'.join(lines)
                price_male = self._parse_price(PRICE_MALE_RE, full_text)
                price_female = self._parse_price(PRICE_FEMALE_RE, full_text)

                for i, line in enumerate(lines):
                    date_m = DATE_RE.search(line)
                    if not date_m:
                        continue

                    mo, d = int(date_m.group(1)), int(date_m.group(2))
                    hour, minute = int(date_m.group(3)), int(date_m.group(4))

                    if not (1 <= mo <= 12 and 1 <= d <= 31):
                        continue

                    # 마감 여부 확인
                    if CLOSED_RE.search(line):
                        continue
                    # 남자마감+여자마감 모두 있으면 스킵
                    if '남자마감' in line and '여자마감' in line:
                        continue

                    try:
                        event_date = datetime(current_year, mo, d, hour, minute)
                        if event_date < now:
                            event_date = datetime(current_year + 1, mo, d, hour, minute)
                        if (event_date - now).days > 365:
                            continue
                    except ValueError:
                        continue

                    date_key = event_date.strftime('%Y%m%d%H%M')
                    if date_key in seen:
                        continue
                    seen.add(date_key)

                    # 회차/연령대 추출: 두 번째 괄호（ 낮 134기 95-02년생 ）
                    brackets = re.findall(r'[（(]([^）)]+)[）)]', line)
                    # 첫 번째는 요일(토/일 등), 두 번째가 회차 정보
                    subtitle = brackets[1].strip() if len(brackets) > 1 else (brackets[0].strip() if brackets else '')

                    # 나이대 라벨: 괄호 내용 또는 라인에서 직접
                    age_group_label = None
                    age_range_min = None
                    age_range_max = None
                    # 제목(line)에서 나이대 추출
                    age_label_m = AGE_LABEL_RE.search(line)
                    if age_label_m:
                        age_group_label = age_label_m.group(1)
                    elif subtitle:
                        al_m = AGE_LABEL_RE.search(subtitle)
                        if al_m:
                            age_group_label = al_m.group(1)

                    # age_group_label → age_range_min/max 변환
                    # 예: "95-02년생", "95~02년생", "1995~2002년생"
                    if age_group_label:
                        m_range = re.search(
                            r'(\d{2,4})\s*[-~]\s*(\d{2,4})',
                            age_group_label,
                        )
                        if m_range:
                            y1 = int(m_range.group(1))
                            y2 = int(m_range.group(2))
                            if y1 < 100:
                                y1 = (2000 + y1) if y1 <= 25 else (1900 + y1)
                            if y2 < 100:
                                y2 = (2000 + y2) if y2 <= 25 else (1900 + y2)
                            # 더 어린 년도(큰 숫자)가 더 낮은 나이(min)
                            age_range_min = current_year - max(y1, y2) + 1
                            age_range_max = current_year - min(y1, y2) + 1

                    # 이벤트별 참가자 현황 파싱 (해당 기수 컨텍스트 블록에서)
                    # 이연시 구조: 날짜 줄 다음에 남/여 각 7명의 생년+직업이 나열됨
                    # 다음 날짜 줄까지를 하나의 블록으로 간주
                    block_end = len(lines)
                    for j in range(i + 1, len(lines)):
                        if DATE_RE.search(lines[j]):
                            block_end = j
                            break
                    event_block_lines = lines[i:block_end]
                    participant_stats = self._parse_participant_stats(event_block_lines)

                    # 잔여석 파싱 (라인 컨텍스트에서)
                    seats_left_male = None
                    seats_left_female = None
                    context_block = ' '.join(lines[max(0, i-2):i+3])

                    # "ㅡ ㅡ N 자리 남았습니다" 패턴
                    seats_m = SEATS_RE.search(context_block)
                    if seats_m:
                        seats_num = int(seats_m.group(1))
                        # 남자 잔여인지 여자 잔여인지 판단
                        if '남' in context_block[max(0, context_block.find(seats_m.group(0))-20):context_block.find(seats_m.group(0))]:
                            seats_left_male = seats_num
                        elif '여' in context_block[max(0, context_block.find(seats_m.group(0))-20):context_block.find(seats_m.group(0))]:
                            seats_left_female = seats_num

                    # 마감 여부 재확인 (여자만 마감, 남자만 마감)
                    is_male_closed = '남자마감' in line
                    is_female_closed = '여자마감' in line
                    if is_male_closed:
                        seats_left_male = 0
                    if is_female_closed:
                        seats_left_female = 0

                    title = sanitize_text(f'[이연시] 광주 7:7 소개팅 {subtitle}', 80)
                    source_url = f'{self.BASE_URL}/?idx=c66d7a938c66fb#evt={date_key}'

                    try:
                        events.append(EventModel(
                            title=title,
                            event_date=event_date,
                            location_region='기타',  # 광주
                            location_detail='광주',
                            price_male=price_male,
                            price_female=price_female,
                            gender_ratio='7:7',
                            source_url=source_url,
                            thumbnail_urls=[],
                            theme=['일반'],
                            seats_left_male=seats_left_male,
                            seats_left_female=seats_left_female,
                            age_group_label=age_group_label,
                            age_range_min=age_range_min,
                            age_range_max=age_range_max,
                            participant_stats=participant_stats,
                        ))
                    except Exception:
                        continue

                browser.close()
        except Exception as e:
            self.logger.error(f'이연시 크롤링 실패: {e}')

        self.logger.info(f'이연시 총 {len(events)}개 이벤트')
        return events

    def _parse_price(self, pattern: re.Pattern, text: str) -> Optional[int]:
        """가격 정규식으로 파싱. 만원 단위 지원."""
        m = pattern.search(text)
        if not m:
            return None
        # 만원 단위
        if m.group(1):
            return int(m.group(1)) * 10000
        # 원 단위 (콤마 포함)
        if m.group(2):
            return int(m.group(2).replace(',', ''))
        return None

    def _parse_participant_stats(self, lines: list[str]) -> Optional[dict]:
        """
        이연시 모집현황 블록에서 기수별 참가자 현황 파싱.

        이연시 실제 형식:
          ✔️남 (모집마감) *️⃣~183     ← 남성 섹션 헤더 (키 제한 포함)
          89/90/89/93/89/89/90        ← 생년 슬래시 구분 목록
          공무원/공공기관/회사원/...   ← 직업 목록
          ✔️여 (모집중)               ← 여성 섹션 헤더
          00/97/96/96/ ㅡ ㅡ 3 자리    ← 생년 (미모집 포함)
          직장인/교사/회사원/공무원/   ← 직업

        반환: {"male": [{"generation": "89", "job": "공무원"}], "female": [...]}
        """
        male_births: list[str] = []
        male_jobs: list[str] = []
        female_births: list[str] = []
        female_jobs: list[str] = []

        # 섹션 추적: None | 'male' | 'female'
        current_section: Optional[str] = None

        for i, line in enumerate(lines):
            # 여성 섹션 헤더 (남성보다 먼저 검사하여 우선 처리)
            if '여' in line and re.search(r'✔|☑|여\s*\(모집|^여\s*(생년|년생|직업|참가|현황)', line):
                current_section = 'female'
                continue

            # 남성 섹션 헤더: "✔️남 (모집마감)", "✔️남 (모집중)", "남 생년" 등
            if '남' in line and re.search(r'✔|☑|남\s*\(모집|^남\s*(생년|년생|직업|참가|현황)', line):
                current_section = 'male'
                continue

            if current_section == 'male':
                # 생년 슬래시 목록 (2자리 숫자 연속): "89/90/89/93"
                birth_m = BIRTH_LIST_RE.search(line)
                if birth_m and not male_births:
                    raw = birth_m.group(1)
                    # 슬래시 뒤 공백/비숫자 제거 후 유효한 숫자만
                    parts = [p.strip() for p in raw.split('/') if re.match(r'^\d{2}$', p.strip())]
                    if parts:
                        male_births = parts
                    continue
                # 직업 슬래시 목록
                job_m = JOB_LIST_RE.search(line)
                if job_m and not male_jobs and male_births:
                    male_jobs = [p.strip() for p in job_m.group(1).split('/') if p.strip()]
                    continue

            elif current_section == 'female':
                birth_m = BIRTH_LIST_RE.search(line)
                if birth_m and not female_births:
                    raw = birth_m.group(1)
                    parts = [p.strip() for p in raw.split('/') if re.match(r'^\d{2}$', p.strip())]
                    if parts:
                        female_births = parts
                    continue
                job_m = JOB_LIST_RE.search(line)
                if job_m and not female_jobs and female_births:
                    female_jobs = [p.strip() for p in job_m.group(1).split('/') if p.strip()]
                    continue

        # fallback: 섹션 헤더 없이 '남'/'여' 포함 라인에서 직접 탐색
        if not male_births and not female_births:
            for line in lines:
                if '남' in line:
                    birth_m = BIRTH_LIST_RE.search(line)
                    if birth_m and not male_births:
                        parts = [p.strip() for p in birth_m.group(1).split('/') if re.match(r'^\d{2}$', p.strip())]
                        male_births = parts
                    job_m = JOB_LIST_RE.search(line)
                    if job_m and not male_jobs:
                        male_jobs = [p.strip() for p in job_m.group(1).split('/') if p.strip()]
                elif '여' in line:
                    birth_m = BIRTH_LIST_RE.search(line)
                    if birth_m and not female_births:
                        parts = [p.strip() for p in birth_m.group(1).split('/') if re.match(r'^\d{2}$', p.strip())]
                        female_births = parts
                    job_m = JOB_LIST_RE.search(line)
                    if job_m and not female_jobs:
                        female_jobs = [p.strip() for p in job_m.group(1).split('/') if p.strip()]

        if not male_births and not female_births:
            return None

        male_list = []
        for idx_b, birth in enumerate(male_births):
            entry: dict = {'generation': birth}
            if idx_b < len(male_jobs):
                entry['job'] = male_jobs[idx_b]
            male_list.append(entry)

        female_list = []
        for idx_b, birth in enumerate(female_births):
            entry = {'generation': birth}
            if idx_b < len(female_jobs):
                entry['job'] = female_jobs[idx_b]
            female_list.append(entry)

        return {
            'male': male_list,
            'female': female_list,
        }
