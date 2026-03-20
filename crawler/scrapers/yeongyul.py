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
    BASE_URL = 'http://yeongyul.com'
    LIST_URL = 'http://yeongyul.com/ab-1131'

    REGION_MAP = {
        '서울': '서울', '강남': '강남', '홍대': '홍대', '수원': '수원',
        '인천': '인천', '부산': '부산', '대구': '대구', '대전': '대전',
        '광주': '기타', '창원': '기타', '마산': '기타', '울산': '기타',
        '경북': '기타', '경남': '기타',
    }

    DATE_RE = re.compile(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})\s+(\d{1,2}):(\d{2})')
    PRICE_RE = re.compile(r'(\d{1,3}(?:,\d{3})*)\s*원')
    LINK_RE = re.compile(r'/ab-\d{4,}-\d{3,}')

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

                # 각 이벤트 상세 페이지 방문
                for url in event_links:
                    try:
                        page.goto(url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        time.sleep(1)

                        soup = BeautifulSoup(page.content(), 'html.parser')
                        ev = self._parse_detail(soup, url)
                        if ev:
                            events.append(ev)
                    except Exception as e:
                        self.logger.warning(f'괜찮소 {url} 파싱 실패: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'괜찮소 크롤링 실패: {e}')

        self.logger.info(f'괜찮소 총 {len(events)}개 이벤트')
        return events

    def _parse_detail(self, soup: BeautifulSoup, url: str) -> Optional[EventModel]:
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
                thumbnail_urls=[],
                theme=['일반'],
                seats_left_male=None,
                seats_left_female=None,
            )
        except Exception:
            return None
