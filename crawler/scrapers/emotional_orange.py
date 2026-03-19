"""에모셔널오렌지 (emotional0ranges.com) 스크래퍼"""
import re
import time
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url


class EmotionalOrangeScraper(BaseScraper):
    BASE_URL = 'https://emotional0ranges.com'
    SCHEDULE_URL = 'https://emotional0ranges.com/schedule'

    def __init__(self):
        super().__init__('emotional_orange')

    def scrape(self) -> list[EventModel]:
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/124.0.0.0 Safari/537.36'
            )
        }
        response = httpx.get(
            self.SCHEDULE_URL, timeout=30, follow_redirects=True, headers=headers
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        events = []
        cards = soup.select(
            '.schedule-card, .event-card, .program-list li, '
            '[class*="schedule"], [class*="event"], [class*="program"]'
        )

        if not cards:
            cards = [
                a.parent for a in soup.select('a[href*="/detail"], a[href*="/event"]')
            ]

        for card in cards:
            try:
                event = self._parse_card(card)
                if event:
                    events.append(event)
                    time.sleep(0.5)
            except Exception as e:
                self.logger.warning(f"카드 파싱 실패: {e}")

        return events

    def _parse_card(self, card) -> Optional[EventModel]:
        title_el = card.select_one('[class*="title"], h2, h3, h4, p strong, b')
        date_el = card.select_one('[class*="date"], time, [class*="day"]')
        link_el = card.select_one('a[href]')
        img_el = card.select_one('img')
        price_el = card.select_one('[class*="price"], [class*="fee"]')
        location_el = card.select_one('[class*="location"], [class*="place"], [class*="area"]')

        if not title_el or not link_el:
            return None

        title = sanitize_text(title_el.get_text(strip=True))
        if not title:
            return None

        source_url = sanitize_url(link_el.get('href'), self.BASE_URL)
        if not source_url:
            return None

        date_text = date_el.get_text(strip=True) if date_el else ''
        event_date = self._parse_date(date_text)
        if not event_date:
            # 제목에서 날짜 추출 시도
            event_date = self._parse_date(title)
        if not event_date:
            return None

        location_text = location_el.get_text(strip=True) if location_el else ''
        price_text = price_el.get_text(strip=True) if price_el else ''

        thumbnail_urls = []
        if img_el:
            src = img_el.get('src') or img_el.get('data-src')
            img_url = sanitize_url(src, self.BASE_URL)
            if img_url:
                thumbnail_urls = [img_url]

        return EventModel(
            title=title,
            event_date=event_date,
            location_region=self._extract_region(location_text + ' ' + title),
            location_detail=sanitize_text(location_text, 200) if location_text else None,
            price_male=self._extract_price_by_gender(price_text, 'male'),
            price_female=self._extract_price_by_gender(price_text, 'female'),
            gender_ratio=self._extract_ratio(title),
            source_url=source_url,
            thumbnail_urls=thumbnail_urls,
            theme=self._extract_theme(title),
        )

    def _parse_date(self, text: str) -> Optional[datetime]:
        text = text.strip()
        current_year = datetime.now().year
        formats = [
            '%Y.%m.%d %H:%M', '%Y-%m-%d %H:%M', '%Y/%m/%d %H:%M',
            '%Y.%m.%d', '%m월 %d일 %H:%M', '%m/%d(%a) %H:%M',
            '%m/%d %H:%M',
        ]
        for fmt in formats:
            try:
                dt = datetime.strptime(text, fmt)
                if dt.year == 1900:
                    dt = dt.replace(year=current_year)
                return dt
            except ValueError:
                continue

        # 패턴 매칭 (예: 3/25(토) 19:00)
        m = re.search(r'(\d{1,2})[./](\d{1,2}).*?(\d{1,2}):(\d{2})', text)
        if m:
            try:
                month, day = int(m.group(1)), int(m.group(2))
                hour, minute = int(m.group(3)), int(m.group(4))
                return datetime(current_year, month, day, hour, minute)
            except ValueError:
                pass

        # 연/월/일만 있는 경우
        m2 = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', text)
        if m2:
            try:
                return datetime(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)), 19, 0)
            except ValueError:
                pass
        return None

    def _extract_region(self, text: str) -> str:
        regions = ['강남', '역삼', '선릉', '홍대', '신촌', '연남', '을지로', '종로',
                   '잠실', '건대', '성수', '이태원', '한남', '수원', '판교', '분당',
                   '인천', '대전']
        for region in regions:
            if region in text:
                return region
        return '기타'

    def _extract_price_by_gender(self, text: str, gender: str) -> Optional[int]:
        if not text:
            return None
        if gender == 'male':
            m = re.search(r'남\s*[성자]?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d+)', text.replace(' ', ''))
        else:
            m = re.search(r'여\s*[성자]?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d+)', text.replace(' ', ''))
        if m:
            return int(m.group(1).replace(',', ''))
        m2 = re.search(r'(\d{1,3}(?:,\d{3})*|\d+)원', text.replace(' ', ''))
        if m2:
            return int(m2.group(1).replace(',', ''))
        return None

    def _extract_ratio(self, text: str) -> Optional[str]:
        m = re.search(r'(\d+)\s*[:：]\s*(\d+)', text)
        if m:
            return f"{m.group(1)}:{m.group(2)}"
        return None

    def _extract_theme(self, text: str) -> list[str]:
        theme_map = {
            '와인': '와인', '커피': '커피', '에세이': '에세이',
            '전시': '전시', '사주': '사주', '보드게임': '보드게임', '쿠킹': '쿠킹',
        }
        themes = [t for k, t in theme_map.items() if k in text]
        return themes if themes else ['일반']
