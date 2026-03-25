"""괜찮소 (yeongyul.com) 스크래퍼 — 오마이사이트 기반, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text


class YeongyulScraper(BaseScraper):
    BASE_URL = 'https://yeongyul.com'
    LIST_URL = 'https://yeongyul.com/ab-1131'

    REGION_MAP = {
        '서울': '서울', '강남': '강남', '홍대': '홍대', '수원': '수원',
        '인천': '인천', '부산': '부산', '대구': '대구', '대전': '대전',
        '광주': '기타', '창원': '기타', '마산': '기타', '울산': '기타',
        '경북': '기타', '경남': '기타',
    }

    DATE_RE = re.compile(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s+(\d{1,2}):(\d{2})')
    PRICE_RE = re.compile(r'(\d{1,3}(?:,\d{3})*)\s*원')
    LINK_RE = re.compile(r'/ab-\d{4,}-\d{3,}')
    # 나이 범위: "나이 : 30세 ~ 38세" 또는 "연령 : 30세 ~ 37세" 또는 별도 행 "30세 ~ 37세"
    AGE_RANGE_RE = re.compile(r'(?:나이|연령)\s*[:\-]?\s*(\d{2,3})\s*세?\s*[~\-]\s*(\d{2,3})\s*세?')
    # 나이 범위 독립 패턴 (나이: 라벨 없이 숫자만 있는 경우 fallback)
    AGE_STANDALONE_RE = re.compile(r'(\d{2,3})\s*세\s*[~\-]\s*(\d{2,3})\s*세')
    # 신청자 현황 행: 나이(36세), 직업(교육) 패턴
    STATS_ROW_RE = re.compile(r'(\d{2,3})\s*세?\s*[,/\s]+(.+)')
    # 목록 페이지 참가자 수 카운트: "[40명 신청중]"
    SIGNUP_COUNT_RE = re.compile(r'\[(\d+)명\s*신청중\]')

    def __init__(self):
        super().__init__('yeongyul')

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

                # 목록 페이지
                page.goto(self.LIST_URL, timeout=20000)
                page.wait_for_load_state('networkidle', timeout=10000)
                time.sleep(2)

                # 이벤트 링크 수집
                event_links = page.eval_on_selector_all(
                    'a[href*="ab-"]',
                    'els => [...new Set(els.map(e => e.href))].filter(h => /ab-\\d{4,}-\\d{3,}/.test(h))'
                )
                self.logger.info(f'괜찮소 이벤트 {len(event_links)}개 발견')

                # 목록 페이지에서 썸네일 미리 수집
                thumbnail_map: dict[str, str] = {}
                try:
                    thumb_data = page.eval_on_selector_all(
                        'img[src*="THUMBNAIL_"]',
                        'els => els.map(e => ({src: e.src, closest: e.closest("a") ? e.closest("a").href : ""}))'
                    )
                    for td in thumb_data:
                        if td.get('closest') and td.get('src'):
                            thumbnail_map[td['closest']] = td['src']
                except Exception as e:
                    self.logger.debug(f'썸네일 수집 실패: {e}')

                # 목록 페이지에서 나이대 및 신청자 수 미리 수집
                # 각 행: "연령 : 30세 ~ 37세", "[40명 신청중]"
                listing_meta: dict[str, dict] = {}
                try:
                    list_html = page.content()
                    from bs4 import BeautifulSoup as _BS
                    list_soup = _BS(list_html, 'html.parser')
                    for row in list_soup.find_all('tr'):
                        link = row.find('a', href=self.LINK_RE)
                        if not link:
                            continue
                        href = link.get('href', '')
                        if not href.startswith('http'):
                            href = f'{self.BASE_URL}/{href.lstrip("/")}'
                        row_text = row.get_text(separator=' ', strip=True)
                        meta: dict = {}
                        # 나이 범위: "연령 : 30세 ~ 37세 [만나이 적용!!]"
                        age_m = self.AGE_RANGE_RE.search(row_text)
                        if not age_m:
                            age_m = self.AGE_STANDALONE_RE.search(row_text)
                        if age_m:
                            meta['age_range_min'] = int(age_m.group(1))
                            meta['age_range_max'] = int(age_m.group(2))
                        # 신청자 수
                        cnt_m = self.SIGNUP_COUNT_RE.search(row_text)
                        if cnt_m:
                            meta['signup_count'] = int(cnt_m.group(1))
                        if meta:
                            listing_meta[href] = meta
                except Exception as e:
                    self.logger.debug(f'목록 메타 수집 실패: {e}')

                # 각 이벤트 상세 페이지 방문
                for url in event_links:
                    try:
                        page.goto(url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        time.sleep(1)

                        soup = BeautifulSoup(page.content(), 'html.parser')
                        thumbnail_url = thumbnail_map.get(url)
                        # 상세 페이지에서 THUMBNAIL_ 이미지 재시도
                        if not thumbnail_url:
                            try:
                                thumb_imgs = page.eval_on_selector_all(
                                    'img[src*="THUMBNAIL_"]',
                                    'els => els.map(e => e.src)'
                                )
                                if thumb_imgs:
                                    thumbnail_url = thumb_imgs[0]
                            except Exception:
                                pass
                        listing_meta_for_url = listing_meta.get(url, {})
                        ev = self._parse_detail(soup, url, thumbnail_url, listing_meta_for_url)
                        if ev:
                            events.append(ev)
                    except Exception as e:
                        self.logger.warning(f'괜찮소 {url} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'괜찮소 크롤링 실패: {e}')

        self.logger.info(f'괜찮소 총 {len(events)}개 이벤트')
        return events

    def _parse_detail(self, soup: BeautifulSoup, url: str, thumbnail_url: Optional[str] = None, listing_meta: Optional[dict] = None) -> Optional[EventModel]:
        text = soup.get_text(separator='\n', strip=True)
        lines = [l.strip() for l in text.split('\n') if l.strip()]

        # 상태 확인 (양쪽 다 마감이면 스킵)
        status_block = ' '.join(lines[30:45])
        is_male_closed = '남자마감' in status_block
        is_female_closed = '여자마감' in status_block
        if is_male_closed and is_female_closed:
            return None

        # 제목: "모임 :" 다음 라인
        title = ''
        for i, line in enumerate(lines):
            if line == '모임 :' or ('모임' in line and line.endswith(':')):
                if i + 1 < len(lines):
                    title = lines[i + 1]
                break
        # fallback: 회차 포함 라인
        if not title:
            for line in lines:
                if '회차' in line and ('소개팅' in line or '미팅' in line):
                    title = line
                    break
        if not title:
            return None

        # 날짜: "일정 :" 또는 "일자 :" 다음 라인
        event_date: Optional[datetime] = None
        for i, line in enumerate(lines):
            if '일정' in line or '일자' in line:
                # 다음 몇 줄 합쳐서 날짜 파싱
                combined = ' '.join(lines[i:i+4])
                date_m = self.DATE_RE.search(combined)
                if date_m:
                    try:
                        event_date = datetime(
                            int(date_m.group(1)), int(date_m.group(2)), int(date_m.group(3)),
                            int(date_m.group(4)), int(date_m.group(5))
                        )
                    except ValueError:
                        pass
                break

        if not event_date or event_date < datetime.now():
            return None

        # 가격: "참가비 :" 다음 라인들 (남성 N원 / 여성 N원 구조)
        price_male: Optional[int] = None
        price_female: Optional[int] = None
        for i, line in enumerate(lines):
            if '참가비' in line:
                combined = ' '.join(lines[i:i+8])
                m_male = re.search(r'남\s*[성]?\s*([\d,]+)\s*원', combined)
                m_female = re.search(r'여\s*[성]?\s*([\d,]+)\s*원', combined)
                if m_male:
                    price_male = int(m_male.group(1).replace(',', ''))
                if m_female:
                    price_female = int(m_female.group(1).replace(',', ''))
                if not m_male and not m_female:
                    prices = [int(m.group(1).replace(',', '')) for m in self.PRICE_RE.finditer(combined)
                              if int(m.group(1).replace(',', '')) >= 5000]
                    if prices:
                        price_male = price_female = prices[0]
                break

        # 장소: "장소 :" 다음 라인
        location_detail = None
        region = '기타'
        for i, line in enumerate(lines):
            if line.startswith('장소'):
                loc_text = lines[i + 1] if i + 1 < len(lines) else ''
                if loc_text and not loc_text.startswith('나이') and not loc_text.startswith('참가'):
                    location_detail = loc_text
                for kw, region_val in self.REGION_MAP.items():
                    if kw in title or kw in (loc_text or ''):
                        region = region_val
                        break
                break

        # 나이 범위 파싱: "나이 : 30세 ~ 38세" 또는 개행 포함 "나이 :\n30세 ~ 37세"
        age_range_min = None
        age_range_max = None
        full_text = '\n'.join(lines)
        # 개행을 공백으로 치환 후 검색 (라벨과 숫자가 별도 줄에 있는 경우 대응)
        normalized_text = re.sub(r'\s+', ' ', full_text)
        age_m = self.AGE_RANGE_RE.search(normalized_text)
        if age_m:
            age_range_min = int(age_m.group(1))
            age_range_max = int(age_m.group(2))
        # fallback: 나이 라벨 없이 "30세 ~ 37세" 독립 패턴
        if age_range_min is None:
            # "나이 :" 라벨 다음 줄에서 탐색
            for i, line in enumerate(lines):
                if '나이' in line or '연령' in line:
                    search_block = ' '.join(lines[i:i+3])
                    sa_m = self.AGE_STANDALONE_RE.search(search_block)
                    if sa_m:
                        age_range_min = int(sa_m.group(1))
                        age_range_max = int(sa_m.group(2))
                        break

        # fallback: 목록 페이지에서 수집한 메타 데이터
        if listing_meta:
            if age_range_min is None:
                age_range_min = listing_meta.get('age_range_min')
            if age_range_max is None:
                age_range_max = listing_meta.get('age_range_max')

        # 신청자 현황 테이블 파싱 → participant_stats
        participant_stats = self._parse_participant_stats(soup, full_text)

        # 목록 페이지의 "[N명 신청중]"으로 total_count 보완
        if listing_meta and listing_meta.get('signup_count') and not participant_stats:
            cnt = listing_meta['signup_count']
            participant_stats = {'male': [], 'female': [], 'total_count': cnt}
        elif listing_meta and listing_meta.get('signup_count') and participant_stats:
            # 이미 테이블 파싱 성공 — total_count 덮어쓰기 (더 정확한 값)
            participant_stats['total_count'] = listing_meta['signup_count']

        clean_title = sanitize_text(f'[괜찮소] {title}', 80)
        source_url = f'{url}#evt={event_date.strftime("%Y%m%d%H%M")}'

        try:
            return EventModel(
                title=clean_title,
                event_date=event_date,
                location_region=region,
                location_detail=location_detail,
                price_male=price_male,
                price_female=price_female,
                gender_ratio=None,
                source_url=source_url,
                thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                theme=['일반'],
                seats_left_male=None,
                seats_left_female=None,
                age_range_min=age_range_min,
                age_range_max=age_range_max,
                participant_stats=participant_stats,
            )
        except Exception:
            return None

    def _parse_participant_stats(self, soup: BeautifulSoup, full_text: str) -> Optional[dict]:
        """
        신청자 현황 테이블 파싱
        실제 구조: 헤더(번호|성별|나이|성명|직업|인원) + 데이터행(1|남|36|홍○○|교육|1명)
        반환: {"male": [{"age": 36, "job": "교육"}], "female": [...], "total_count": 27}
        """
        male_list = []
        female_list = []

        # 신청현황 테이블: 컬럼 순서 번호(0)/성별(1)/나이(2)/성명(3)/직업(4)/인원(5)
        # 헤더 행에 "번호", "성별", "나이", "직업" 텍스트가 있는 테이블을 찾음
        tables = soup.find_all('table')
        for table in tables:
            rows = table.find_all('tr')
            if not rows:
                continue

            # 헤더 행에서 컬럼 인덱스 탐지
            col_gender = None
            col_age = None
            col_job = None
            header_row = rows[0]
            header_cells = header_row.find_all(['th', 'td'])
            header_texts = [c.get_text(strip=True) for c in header_cells]

            # "번호 성별 나이 성명 직업 인원" 구조 확인
            if '성별' in header_texts and '나이' in header_texts:
                col_gender = header_texts.index('성별') if '성별' in header_texts else None
                col_age = header_texts.index('나이') if '나이' in header_texts else None
                col_job = header_texts.index('직업') if '직업' in header_texts else None
            else:
                # 기존 방식: 남/여 신청자/현황 헤더 행 탐색
                current_gender = None
                for row in rows:
                    row_text = row.get_text(separator=' ', strip=True)
                    if '남' in row_text and ('신청자' in row_text or '참가자' in row_text or '현황' in row_text):
                        current_gender = 'male'
                        continue
                    elif '여' in row_text and ('신청자' in row_text or '참가자' in row_text or '현황' in row_text):
                        current_gender = 'female'
                        continue
                    if current_gender:
                        cells = row.find_all(['td', 'th'])
                        if len(cells) >= 2:
                            entry: dict = {}
                            cell_texts = [c.get_text(strip=True) for c in cells]
                            for ct in cell_texts:
                                age_m = re.match(r'^(\d{2,3})$', ct)
                                if age_m:
                                    entry['age'] = int(age_m.group(1))
                                elif ct and not re.match(r'^[\d,]+원$', ct) and ct not in ('남', '여', '1명', '2명'):
                                    entry['job'] = ct
                            if 'age' in entry or 'job' in entry:
                                if current_gender == 'male':
                                    male_list.append(entry)
                                else:
                                    female_list.append(entry)
                continue

            # 컬럼 인덱스 기반 파싱 (신청현황 테이블 구조)
            if col_gender is not None and col_age is not None:
                for row in rows[1:]:  # 헤더 제외
                    cells = row.find_all(['td', 'th'])
                    if len(cells) <= max(filter(None, [col_gender, col_age, col_job])):
                        continue
                    gender_text = cells[col_gender].get_text(strip=True) if col_gender < len(cells) else ''
                    age_text = cells[col_age].get_text(strip=True) if col_age is not None and col_age < len(cells) else ''
                    job_text = cells[col_job].get_text(strip=True) if col_job is not None and col_job < len(cells) else ''

                    entry = {}
                    if re.match(r'^\d{2,3}$', age_text):
                        entry['age'] = int(age_text)
                    if job_text and not re.match(r'^[\d,]+원$', job_text) and job_text not in ('남', '여', '1명', '2명'):
                        entry['job'] = job_text

                    if entry:
                        if gender_text == '남':
                            male_list.append(entry)
                        elif gender_text == '여':
                            female_list.append(entry)

        if not male_list and not female_list:
            return None

        total = len(male_list) + len(female_list)
        return {'male': male_list, 'female': female_list, 'total_count': total}
