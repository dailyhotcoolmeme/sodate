"""솔로오프 (solo-off.com) 스크래퍼
solo-off.com은 imweb 기반으로 headless 감지로 직접 크롤링 불가.
공식 일정 게시판(solo-off.com/26/)에서 httpx로 파싱 시도.
"""
import re
import time
import httpx
from datetime import datetime, timedelta
from typing import Optional
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

FALLBACK_PRICE_FEMALE = 29000
FALLBACK_PRICE_MALE = 59000

BASE_URL = 'https://www.solo-off.com'
SCHEDULE_URL = 'https://www.solo-off.com/26/'

# 날짜 패턴
DATE_RE = re.compile(r'(\d{1,2})\.(\d{1,2})\([가-힣]\)|(\d{1,2})/(\d{1,2})\([가-힣]\)')
# 나이 그룹 문자
GROUP_RE = re.compile(r'소개팅\s*([A-Z])\b|그룹\s*([A-Z])\b')
# 나이 범위: "95-02년생", "95~02년생"
AGE_RANGE_RE = re.compile(r'(\d{2})[~-](\d{2})년생')
# 시간 패턴
TIME_RE = re.compile(r'오후\s*(\d+)시(?:\s*(\d+)분)?|(\d{1,2}):(\d{2})')


class SolooffScraper(BaseScraper):
    REGION_KEYWORDS = [
        '강남', '홍대', '신촌', '잠실', '건대', '구로', '종로',
        '수원', '대전', '대구', '부산', '인천', '천안', '마곡',
    ]

    def __init__(self):
        super().__init__('solo-off')

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        try:
            events = self._scrape_with_playwright()
        except Exception as e:
            self.logger.error(f'솔로오프 크롤링 실패: {e}')

        self.logger.info(f'솔로오프 총 {len(events)}개 이벤트')
        return events

    def _scrape_with_playwright(self) -> list[EventModel]:
        """Playwright로 solo-off.com/26/ 게시판 파싱"""
        events: list[EventModel] = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                ignore_https_errors=True,
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            )
            page = context.new_page()
            page.goto(SCHEDULE_URL, timeout=20000)
            page.wait_for_load_state('networkidle', timeout=10000)
            soup = BeautifulSoup(page.content(), 'html.parser')

            # 게시물 링크 수집
            post_links = []
            for a in soup.select('a[href]'):
                href = a.get('href', '')
                text = a.get_text(strip=True)
                if not href or not text:
                    continue
                if re.search(r'\d{1,2}월', text) or re.search(r'소개팅|일정|로테', text):
                    full_url = href if href.startswith('http') else BASE_URL + href
                    if full_url not in post_links and '/26/' not in full_url:
                        post_links.append(full_url)

            self.logger.info(f'솔로오프 게시물 {len(post_links)}개 발견')

            for url in post_links[:3]:
                try:
                    page.goto(url, timeout=15000)
                    page.wait_for_load_state('networkidle', timeout=8000)
                    detail_soup = BeautifulSoup(page.content(), 'html.parser')
                    content = page.inner_text('body')
                    thumb_imgs = page.eval_on_selector_all('img[src*="cdn.imweb"], img[src*="imweb"]', 'els => els.map(e => e.src)')
                    thumbnail_url = thumb_imgs[0] if thumb_imgs else None
                    parsed = self._parse_post(content, url, thumbnail_url)
                    events.extend(parsed)
                    time.sleep(0.5)
                except Exception as e:
                    self.logger.warning(f'솔로오프 게시물 파싱 실패 {url}: {e}')

            browser.close()
        return events

    def _parse_post(self, content: str, source_url: str, thumbnail_url: Optional[str]) -> list[EventModel]:
        """게시물 텍스트에서 이벤트 추출"""
        events: list[EventModel] = []
        now = datetime.now()

        year_m = re.search(r'(202\d)', content)
        month_m = re.search(r'(\d{1,2})월', content[:200])
        current_year = int(year_m.group(1)) if year_m else now.year
        current_month = int(month_m.group(1)) if month_m else now.month

        # 나이 그룹 매핑 미리 구성
        age_map: dict[str, str] = {}
        for gm in re.finditer(r'소개팅\s*([A-Z])[^\n]*?(\d{2})[~-](\d{2})년생', content):
            key = gm.group(1)
            age_map[key] = f"{gm.group(2)}-{gm.group(3)}년생"

        lines = [l.strip() for l in content.split('\n') if l.strip()]
        price_m = re.search(r'(\d{2,3})[,.]?(\d{3})원', content)
        price_val = int(price_m.group(1).replace(',', '') + price_m.group(2)) if price_m else None

        for i, line in enumerate(lines):
            dm = DATE_RE.search(line)
            if not dm:
                continue
            try:
                mo = int(dm.group(1) or dm.group(3))
                day = int(dm.group(2) or dm.group(4))
                event_year = year_m and current_year or now.year
                if mo < current_month:
                    event_year = current_year + 1

                # 시간 파싱
                hour, minute = 19, 0
                tm = TIME_RE.search(line)
                if tm:
                    if tm.group(1):  # 오후 N시
                        h = int(tm.group(1))
                        hour = h + 12 if h < 12 else h
                        minute = int(tm.group(2)) if tm.group(2) else 0
                    elif tm.group(3):  # HH:MM
                        hour, minute = int(tm.group(3)), int(tm.group(4))
                        if hour < 12:
                            hour += 12

                event_dt = datetime(event_year, mo, day, hour, minute)
                if event_dt < now:
                    continue

                # 지역
                region = '강남'
                for r in self.REGION_KEYWORDS:
                    ctx = ' '.join(lines[max(0, i-2):i+3])
                    if r in ctx:
                        region = r
                        break

                # 나이 그룹
                group_m = GROUP_RE.search(line)
                group_key = (group_m.group(1) or group_m.group(2)) if group_m else None
                age_group_label = age_map.get(group_key) if group_key else None

                # age_range 변환
                age_range_min, age_range_max = None, None
                if age_group_label:
                    ym = re.match(r'(\d{2})-(\d{2})년생', age_group_label)
                    if ym:
                        y1 = (2000 + int(ym.group(1))) if int(ym.group(1)) <= 30 else (1900 + int(ym.group(1)))
                        y2 = (2000 + int(ym.group(2))) if int(ym.group(2)) <= 30 else (1900 + int(ym.group(2)))
                        a1, a2 = 2026 - y1 + 1, 2026 - y2 + 1
                        age_range_min, age_range_max = min(a1, a2), max(a1, a2)

                date_key = event_dt.strftime('%Y%m%d%H%M')
                events.append(EventModel(
                    title=sanitize_text(f'[솔로오프] {region} 로테이션 소개팅' + (f' ({age_group_label})' if age_group_label else ''), 80),
                    event_date=event_dt,
                    location_region=region,
                    location_detail=region,
                    price_male=price_val or FALLBACK_PRICE_MALE,
                    price_female=FALLBACK_PRICE_FEMALE,
                    source_url=f'{BASE_URL}#evt={date_key}',
                    thumbnail_urls=[thumbnail_url] if thumbnail_url else [],
                    theme=['일반'],
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    participant_stats=None,
                ))
            except (ValueError, IndexError):
                continue
        return events
