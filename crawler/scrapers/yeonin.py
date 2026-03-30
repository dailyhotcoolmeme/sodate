"""연인어때 (yeonin.co.kr) 스크래퍼"""
import re
import time
import asyncio
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url
from utils.date_filter import is_within_one_month


# ─────────────────────────────────────────────
# 나이 변환 유틸 (한국 나이 기준)
# 2026 - 년생 + 1
# 예: 95년생 → 32세, 02년생 → 25세
# ─────────────────────────────────────────────
BASE_YEAR = 2026


def _year2age(year_2digit_or_4digit: str) -> int:
    """'95', '02', '1995', '2002' 형태의 년생 문자열 → 한국 나이(int)"""
    y = int(year_2digit_or_4digit)
    if y < 100:
        # 2자리 년생: 00~30 → 2000년대, 31~99 → 1900년대
        y = (2000 + y) if y <= 30 else (1900 + y)
    return BASE_YEAR - y + 1


def _parse_age_range_from_label(age_group_label: str) -> tuple[Optional[int], Optional[int]]:
    """
    'A그룹(95~02년생)' 또는 '남: 95-02년생' 형태에서
    age_range_min(작은 나이), age_range_max(큰 나이) 추출.

    출생년도가 클수록(최근) 나이는 어리므로:
      min_year(큰 숫자, 예:02) → 작은 나이 → age_range_min
      max_year(작은 숫자, 예:95) → 큰 나이  → age_range_max
    """
    m = re.search(r'(\d{2,4})\s*[-~]\s*(\d{2,4})년생', age_group_label)
    if not m:
        return None, None
    yr1, yr2 = m.group(1), m.group(2)
    age1, age2 = _year2age(yr1), _year2age(yr2)
    return min(age1, age2), max(age1, age2)


class YeoninScraper(BaseScraper):
    BASE_URL = 'https://yeonin.co.kr'
    SCHEDULE_URL = 'https://yeonin.co.kr/schedule'
    LIST_URL = 'https://yeonin.co.kr/list'

    def __init__(self):
        super().__init__('yeonin')

    def scrape(self) -> list[EventModel]:
        events = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(ignore_https_errors=True, user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
                page = context.new_page()

                # 1단계: 일정 목록 페이지에서 최신 월별 게시물 링크 수집
                page.goto(self.SCHEDULE_URL, timeout=15000)
                page.wait_for_load_state('networkidle', timeout=10000)

                soup = BeautifulSoup(page.content(), 'html.parser')
                post_links = []
                for a in soup.select('a[href*="bmode=view"]'):
                    href = a.get('href', '')
                    title = a.get_text(strip=True)
                    if title and ('소개팅' in title or '일정' in title or '로테이션' in title):
                        full_url = href if href.startswith('http') else self.BASE_URL + href
                        post_links.append((title, full_url))

                self.logger.info(f'일정 게시물 {len(post_links)}개 발견')

                # 2단계: /list 페이지에서 참가자 명단 게시글 목록 수집
                participant_data: dict[str, dict] = {}
                try:
                    page.goto(self.LIST_URL, timeout=15000)
                    page.wait_for_load_state('networkidle', timeout=8000)
                    list_soup = BeautifulSoup(page.content(), 'html.parser')
                    # 게시글 링크 추출 후 각 게시글의 og:description 파싱
                    list_post_links = []
                    for a in list_soup.select('a[href*="bmode=view"]'):
                        href = a.get('href', '')
                        full_url = href if href.startswith('http') else self.BASE_URL + href
                        if full_url not in list_post_links:
                            list_post_links.append(full_url)

                    self.logger.info(f'/list 게시글 링크 {len(list_post_links)}개 발견')

                    # 최신 30개 게시글에서 참가자 명단 파싱
                    for list_url in list_post_links[:30]:
                        try:
                            page.goto(list_url, timeout=15000)
                            page.wait_for_load_state('networkidle', timeout=8000)
                            list_detail_soup = BeautifulSoup(page.content(), 'html.parser')

                            # og:description 메타 태그에 참가자 데이터가 있음
                            og_desc = list_detail_soup.find('meta', property='og:description')
                            og_title = list_detail_soup.find('meta', property='og:title')
                            if og_desc and og_title:
                                title_content = og_title.get('content', '')
                                desc_content = og_desc.get('content', '')
                                parsed = self._parse_participant_from_og(title_content, desc_content)
                                if parsed:
                                    date_key, data = parsed
                                    participant_data[date_key] = data
                            time.sleep(0.5)
                        except Exception as e:
                            self.logger.warning(f'/list 게시글 파싱 실패 {list_url}: {e}')

                    self.logger.info(f'참가자 현황 {len(participant_data)}건 수집')
                except Exception as e:
                    self.logger.warning(f'/list 페이지 수집 실패: {e}')

                # 3단계: 최신 게시물 최대 3개만 파싱
                for title, url in post_links[:3]:
                    try:
                        page.goto(url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        detail_soup = BeautifulSoup(page.content(), 'html.parser')

                        thumbnail_url = None
                        imgs = page.eval_on_selector_all('img[src*="cdn.imweb"]', 'els => els.map(e => e.src)')
                        if imgs:
                            thumbnail_url = imgs[0]

                        # og:description 에서 그룹 정보 추출 (가장 신뢰도 높음)
                        og_desc_meta = detail_soup.find('meta', property='og:description')
                        age_groups_from_og = []
                        if og_desc_meta:
                            age_groups_from_og = self._parse_age_groups_from_og(og_desc_meta.get('content', ''))

                        # 테이블 파싱 방식으로 그룹 정보 추출 (fallback)
                        age_groups_from_table = self._parse_age_groups_from_table(detail_soup)

                        # og에서 추출된 것이 있으면 우선, 없으면 테이블 사용
                        age_groups = age_groups_from_og if age_groups_from_og else age_groups_from_table

                        content_text = page.inner_text('body')

                        parsed = self._parse_post(title, content_text, url, thumbnail_url, age_groups, participant_data)
                        events.extend(parsed)
                        time.sleep(1)
                    except Exception as e:
                        self.logger.warning(f'게시물 파싱 실패 {url}: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'크롤링 실패: {e}')
            raise

        filtered = []
        for ev in events:
            if is_within_one_month(ev.event_date):
                filtered.append(ev)
            else:
                self.logger.debug(f"날짜 범위 초과 스킵 ({ev.event_date}): {ev.source_url}")
        self.logger.info(f'연인어때 총 {len(filtered)}개 이벤트 (필터 전: {len(events)}개)')
        return filtered

    def _parse_age_groups_from_og(self, og_description: str) -> list[str]:
        """
        og:description 에서 그룹별 나이대 추출.

        실제 포맷 예시:
          "로테이션 소개팅 A남: 95-02년생여: 제한 없음 ❌남: 키 172 이상여: 키 150 이상
           로테이션 소개팅 B남: 92-99년생여: 제한 없음 ❌..."

        반환: ['A그룹(95~02년생)', 'B그룹(92~99년생)', ...]
        """
        age_groups = []
        # "로테이션 소개팅 X남: YY-ZZ년생" 패턴
        pattern = re.compile(
            r'로테이션\s*소개팅\s*([A-D])(?:\s*\([^)]*\))?\s*남\s*:\s*(\d{2,4})\s*[-~]\s*(\d{2,4})년생'
        )
        for m in pattern.finditer(og_description):
            group_letter = m.group(1)
            yr1, yr2 = m.group(2), m.group(3)
            # 두 자리 년도를 4자리로 정규화
            y1_norm = (2000 + int(yr1)) if int(yr1) <= 30 else (1900 + int(yr1))
            y2_norm = (2000 + int(yr2)) if int(yr2) <= 30 else (1900 + int(yr2))
            # 표시는 2자리로 (원문 그대로)
            age_groups.append(f'{group_letter}그룹({yr1}~{yr2}년생)')
        return age_groups

    def _parse_age_groups_from_table(self, soup: BeautifulSoup) -> list[str]:
        """게시물 첫 번째 <table>에서 그룹 A/B/C/D 연령대 추출

        실제 테이블 구조:
          td[0]: "로테이션 소개팅 A"
          td[1]: "남: 95-02년생 여: 제한 없음"
        셀이 분리되어 있으므로 td 단위로 직접 접근하여 파싱한다.
        """
        age_groups = []
        tables = soup.select('table')
        if not tables:
            return age_groups

        first_table = tables[0]
        rows = first_table.find_all('tr')
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
            if not cells:
                continue

            # 첫 번째 셀에서 그룹 레이블 추출 (A, B, C, D 또는 A그룹 등)
            group_label = None
            label_m = re.search(r'([A-D])\s*그룹', cells[0])
            if label_m:
                group_label = label_m.group(1) + '그룹'
            else:
                # "로테이션 소개팅 A" 형태에서 끝에 오는 알파벳 추출
                label_m2 = re.search(r'\b([A-D])\b', cells[0])
                if label_m2:
                    group_label = label_m2.group(1) + '그룹'

            if not group_label:
                # 그룹 라벨이 없으면 row_text 전체에서 fallback 패턴 시도
                row_text = ' '.join(cells)
                m = re.search(r'([A-D]그룹[^\)]*\))', row_text)
                if m:
                    age_groups.append(m.group(1))
                    continue
                m2 = re.search(r'([A-D])\s*[:\-]\s*(\d{2,4}[-~]\d{2,4}년생)', row_text)
                if m2:
                    age_groups.append(f'{m2.group(1)}그룹({m2.group(2)})')
                continue

            # 나머지 셀에서 년생 범위 패턴 추출
            age_range = None
            for cell_text in cells[1:]:
                age_m = re.search(r'(\d{2,4}[-~]\d{2,4}년생)', cell_text)
                if age_m:
                    age_range = age_m.group(1)
                    break

            if age_range:
                age_groups.append(f'{group_label}({age_range})')
            else:
                # 나이 범위 없이 그룹 레이블만 있는 경우도 추가
                age_groups.append(group_label)

        return age_groups

    def _parse_participant_from_og(self, og_title: str, og_description: str) -> Optional[tuple[str, dict]]:
        """
        /list 게시글의 og:title + og:description 에서 참가자 명단 파싱.

        og:title 예: "3/29(일) 오후 5시30분(나이B) : 참가자 명단 | ..."
        og:description 예:
          "...남성 참가자♥1호 - 90중반/자영업/176/다정 ♥2호 - ...
           여성 참가자♥1호 - 90후반/서비스직/163/... ♥ 모집 마감 ♥"

        반환: (date_key, {'male': [...], 'female': [...], 'group': 'B', 'seats_left_male': int, 'seats_left_female': int})
        """
        # 날짜 키 추출 (예: "3/29")
        date_m = re.search(r'(\d{1,2})/(\d{1,2})', og_title)
        if not date_m:
            return None
        date_key = f"{date_m.group(1)}/{date_m.group(2)}"

        # 그룹 레이블 추출 (나이B → B)
        group_m = re.search(r'나이([A-D])', og_title)
        group_letter = group_m.group(1) if group_m else None

        # 남성/여성 참가자 섹션 분리
        male_section = ''
        female_section = ''

        male_split = re.split(r'남성\s*참가자', og_description)
        if len(male_split) > 1:
            rest = male_split[1]
            female_split = re.split(r'여성\s*참가자', rest)
            male_section = female_split[0]
            if len(female_split) > 1:
                female_section = female_split[1]

        def parse_section(section_text: str) -> tuple[list[dict], int]:
            """참가자 섹션 텍스트에서 참가자 목록과 잔여석 수 반환"""
            participants = []
            seats_left = 0

            # "♥N호 - 정보/직업/키/키워드" 패턴
            entries = re.findall(r'♥\d+호\s*-\s*([^♥]+)', section_text)
            for entry in entries:
                entry = entry.strip()
                if '신청 가능' in entry:
                    seats_left += 1
                    continue
                if '정보 확인 중' in entry or '모집' in entry:
                    continue

                parts = [p.strip() for p in entry.split('/')]
                info: dict = {}

                # 연대 정보 (첫 번째 파트: "90중반", "00초반" 등)
                if parts:
                    gen_m = re.search(r'(\d{2}(?:초반|중반|후반))', parts[0])
                    if gen_m:
                        info['generation'] = gen_m.group(1)

                # 직업 (두 번째 파트)
                if len(parts) > 1:
                    info['job'] = parts[1]

                # 키 (세 번째 파트: 숫자)
                if len(parts) > 2:
                    height_m = re.search(r'(1[5-9]\d)', parts[2])
                    if height_m:
                        info['height'] = int(height_m.group(1))

                # 매력 포인트 (네 번째 파트)
                if len(parts) > 3:
                    info['trait'] = parts[3]

                if info:
                    participants.append(info)

            return participants, seats_left

        male_list, seats_left_male = parse_section(male_section)
        female_list, seats_left_female = parse_section(female_section)

        if not male_list and not female_list:
            return None

        result = {
            'male': male_list,
            'female': female_list,
            'group': group_letter,
            'seats_left_male': seats_left_male,
            'seats_left_female': seats_left_female,
            'male_count': len(male_list),
            'female_count': len(female_list),
        }
        return date_key, result

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

    def _extract_price(self, text: str, gender: str = 'male') -> Optional[int]:
        """텍스트에서 성별에 맞는 가격(원)을 추출. 없으면 None.

        '남성: 40,000원 / 여성: 35,000원' 형태를 지원한다.
        gender='male' → 남성 가격, gender='female' → 여성 가격.
        성별 구분이 없는 경우 첫 번째 가격을 반환한다.
        """
        price_re = re.compile(r'([\d,]+)원')

        if gender == 'male':
            # 남성 가격: '남성:' 이후 첫 번째 숫자
            male_m = re.search(r'남성\s*:\s*([\d,]+)원', text)
            if male_m:
                return int(male_m.group(1).replace(',', ''))
        elif gender == 'female':
            # 여성 가격: '여성:' 이후 첫 번째 숫자
            female_m = re.search(r'여성\s*:\s*([\d,]+)원', text)
            if female_m:
                return int(female_m.group(1).replace(',', ''))

        # 성별 구분 없이 첫 번째 가격 반환
        m = price_re.search(text)
        if m:
            return int(m.group(1).replace(',', ''))
        return None

    def _extract_seats(self, text: str) -> Optional[int]:
        """텍스트에서 잔여석 수를 추출. '마감' 등 잔여 없음 표시면 None 반환."""
        if '마감' in text or '완료' in text:
            return None
        m = re.search(r'잔여\s*(\d+)\s*석', text)
        if m:
            return int(m.group(1))
        m2 = re.search(r'(\d+)\s*자리', text)
        if m2:
            return int(m2.group(1))
        return None

    def _parse_participant_list(self, soup: BeautifulSoup) -> dict[str, dict]:
        """
        /list 게시판에서 참가자 현황 테이블 파싱 (레거시 fallback)
        반환: {날짜키: {"male": [...], "female": [...]}}
        """
        result: dict[str, dict] = {}
        tables = soup.select('table')
        for table in tables:
            rows = table.find_all('tr')
            current_date_key = None
            male_list = []
            female_list = []

            for row in rows:
                row_text = row.get_text(separator=' ', strip=True)

                # 날짜 키 추출
                date_m = re.search(r'(\d{1,2})/(\d{1,2})', row_text)
                if date_m and ('소개팅' in row_text or '일정' in row_text or '회차' in row_text):
                    if current_date_key and (male_list or female_list):
                        result[current_date_key] = {'male': male_list, 'female': female_list}
                    current_date_key = f"{date_m.group(1)}/{date_m.group(2)}"
                    male_list = []
                    female_list = []
                    continue

                # 남성 참가자 행: "남", 생년, 직업, 키 패턴
                if '남' in row_text and re.search(r'\d{2}년생|\d{4}년생', row_text):
                    cells = row.find_all(['td', 'th'])
                    entry = self._parse_participant_row(cells)
                    if entry:
                        male_list.append(entry)

                # 여성 참가자 행
                elif '여' in row_text and re.search(r'\d{2}년생|\d{4}년생', row_text):
                    cells = row.find_all(['td', 'th'])
                    entry = self._parse_participant_row(cells)
                    if entry:
                        female_list.append(entry)

            if current_date_key and (male_list or female_list):
                result[current_date_key] = {'male': male_list, 'female': female_list}

        return result

    def _parse_participant_row(self, cells: list) -> Optional[dict]:
        """테이블 행(셀 목록)에서 참가자 정보 딕셔너리 추출"""
        texts = [c.get_text(strip=True) for c in cells if c.get_text(strip=True)]
        if len(texts) < 2:
            return None

        entry: dict = {}
        for t in texts:
            # 생년: 90중반, 95년생 등
            gen_m = re.search(r'(\d{2}(?:년생|대|초반|중반|후반))', t)
            if gen_m:
                entry['generation'] = gen_m.group(1)
            # 키: 160~195 범위
            height_m = re.search(r'(1[6-9]\d)\s*cm?', t)
            if height_m:
                entry['height'] = int(height_m.group(1))
            # 직업 키워드
            job_keywords = ['IT', '개발', '간호', '교사', '교육', '공무원', '의사', '대기업', '중소기업',
                            '프리랜서', '디자인', '영업', '금융', '연구', '회계', '마케팅']
            for kw in job_keywords:
                if kw in t:
                    entry['job'] = t
                    break

        return entry if entry else None

    def _parse_post(self, post_title: str, content: str, source_url: str,
                    thumbnail_url: Optional[str], age_groups: list[str],
                    participant_data: dict[str, dict]) -> list[EventModel]:
        """월별 일정 게시물 텍스트에서 개별 이벤트 추출 (테이블 파싱 방식)"""
        events = []
        lines = [l.strip() for l in content.split('\n') if l.strip()]

        # 현재 연도/월 파악
        year_match = re.search(r'(\d{4})년', post_title + content)
        month_match = re.search(r'(\d{1,2})월', post_title)
        current_year = int(year_match.group(1)) if year_match else datetime.now().year
        current_month = int(month_match.group(1)) if month_match else datetime.now().month

        # 날짜 + 그룹 패턴 찾기
        # 예: "3/15 로테이션 소개팅 A", "3월 22일", "3.15(토)"
        date_pattern = re.compile(
            r'(?:(\d{1,2})[월/.](\d{1,2})일?)\s*(?:\([월화수목금토일]\))?'
        )

        # 가격 패턴
        price_pattern = re.compile(r'(\d{2,3}),?(\d{3})원?|(\d{4,6})원')

        # 지역 키워드
        region_keywords = ['강남', '홍대', '신촌', '잠실', '건대', '성수', '수원', '인천', '부산', '대구', '대전', '천안', '구로', '종로']

        # 나이대 라벨 패턴 (본문에서)
        age_label_pattern = re.compile(r'([A-D]그룹[^\s,]+|[A-D]그룹\(\d{2,4}[-~]\d{2,4}년생\))')

        for i, line in enumerate(lines):
            date_match = date_pattern.search(line)
            if not date_match:
                continue

            try:
                m = int(date_match.group(1))
                d = int(date_match.group(2))
                # 월이 현재 월이거나 다음 달이면 사용
                if m < 1 or m > 12 or d < 1 or d > 31:
                    continue

                event_date = datetime(current_year, m, d, 14, 0)
                if event_date < datetime.now():
                    continue

                # 제목: 현재 줄 + 앞뒤 컨텍스트
                context_lines = lines[max(0, i-1):i+3]
                title_text = ' '.join(context_lines)[:100]
                title = sanitize_text(f'[연인어때] {title_text}', 80)

                # 가격 추출
                price_text = ' '.join(lines[max(0, i-2):i+5])
                prices = price_pattern.findall(price_text)
                price_male = None
                price_female = None
                if prices:
                    for p in prices:
                        val = int(p[0] + p[1]) if p[0] else int(p[2]) if p[2] else 0
                        if val > 10000:
                            if price_male is None:
                                price_male = val
                            elif price_female is None:
                                price_female = val

                # 지역 추출
                region = '서울'
                for r in region_keywords:
                    if r in title_text:
                        region = r
                        break

                # 나이대 라벨 추출 (본문 라인에서)
                age_group_label = None
                # 테이블(또는 og)에서 파싱한 그룹이 있으면 우선 사용
                if age_groups:
                    # 라인에서 그룹 A/B/C/D 언급 찾기
                    group_m = re.search(r'([A-D])\s*(?:그룹|조|팀)?', title_text)
                    if group_m:
                        group_letter = group_m.group(1)
                        for ag in age_groups:
                            if ag.startswith(group_letter):
                                age_group_label = ag
                                break
                    if not age_group_label and age_groups:
                        age_group_label = age_groups[0]
                # 본문에서 직접 추출
                if not age_group_label:
                    al_m = age_label_pattern.search(title_text)
                    if al_m:
                        age_group_label = al_m.group(1)

                # ─────────────────────────────────────
                # age_range_min / age_range_max 변환
                # ─────────────────────────────────────
                age_range_min, age_range_max = None, None
                if age_group_label:
                    age_range_min, age_range_max = _parse_age_range_from_label(age_group_label)

                # 참가자 현황: 날짜 키로 매칭
                # participant_data 키는 "M/D" 형태
                date_key_str = f"{m}/{d}"
                participant_stats = participant_data.get(date_key_str)

                # 잔여석 정보를 participant_stats에서 추출
                seats_left_male = None
                seats_left_female = None
                if participant_stats:
                    seats_left_male = participant_stats.get('seats_left_male')
                    seats_left_female = participant_stats.get('seats_left_female')

                # source_url에 날짜+시간 포함하여 이벤트마다 유니크하게
                unique_url = f"{source_url}#evt={event_date.strftime('%Y%m%d%H%M')}"
                events.append(EventModel(
                    title=title,
                    event_date=event_date,
                    location_region=region,
                    location_detail=None,
                    price_male=price_male,
                    price_female=price_female,
                    gender_ratio=None,
                    source_url=unique_url,
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    seats_left_male=seats_left_male,
                    seats_left_female=seats_left_female,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=participant_stats,
                ))

            except (ValueError, IndexError):
                continue

        return events
