"""연인어때 (yeonin.co.kr) 스크래퍼"""
import re
import time
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url


class YeoninScraper(BaseScraper):
    BASE_URL = 'https://yeonin.co.kr'
    SCHEDULE_URL = 'https://yeonin.co.kr/schedule'

    def __init__(self):
        super().__init__('yeonin')

    def scrape(self) -> list[EventModel]:
        response = httpx.get(self.SCHEDULE_URL, timeout=30, follow_redirects=True)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        events = []
        cards = soup.select(
            '.schedule-item, .event-item, .program-card, '
            '[class*="schedule"], [class*="event"], [class*="program"]'
        )

        if not cards:
            cards = [
                a.parent for a in soup.select('a[href*="/detail/"], a[href*="/event/"]')
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
        title_el = card.select_one('[class*="title"], h2, h3, h4, strong')
        date_el = card.select_one('[class*="date"], time, [class*="time"]')
        link_el = card.select_one('a[href]')
        img_el = card.select_one('img')
        price_el = card.select_one('[class*="price"], [class*="fee"], [class*="cost"]')
        location_el = card.select_one('[class*="region"], [class*="location"], [class*="place"]')
        ratio_el = card.select_one('[class*="ratio"], [class*="gender"]')
        seat_el = card.select_one('[class*="seat"], [class*="remain"], [class*="left"]')

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
            return None

        location_text = location_el.get_text(strip=True) if location_el else title
        price_text = price_el.get_text(strip=True) if price_el else ''
        ratio_text = ratio_el.get_text(strip=True) if ratio_el else title

        thumbnail_urls = []
        if img_el:
            img_url = sanitize_url(img_el.get('src') or img_el.get('data-src'), self.BASE_URL)
            if img_url:
                thumbnail_urls = [img_url]

        seats_left = self._extract_seats(seat_el.get_text(strip=True) if seat_el else '')

        return EventModel(
            title=title,
            event_date=event_date,
            location_region=self._extract_region(location_text + ' ' + title),
            location_detail=sanitize_text(location_text, 200),
            price_male=self._extract_price(price_text, gender='male'),
            price_female=self._extract_price(price_text, gender='female'),
            gender_ratio=self._extract_ratio(ratio_text),
            source_url=source_url,
            thumbnail_urls=thumbnail_urls,
            theme=self._extract_theme(title),
            seats_left_male=seats_left,
            seats_left_female=seats_left,
        )

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        date_str = date_str.strip()
        formats = [
            '%Y.%m.%d %H:%M', '%Y-%m-%d %H:%M', '%Y/%m/%d %H:%M',
            '%Y.%m.%d', '%m월 %d일 %H:%M', '%m월%d일 %H시%M분',
        ]
        current_year = datetime.now().year
        for fmt in formats:
            try:
                dt = datetime.strptime(date_str, fmt)
                if dt.year == 1900:
                    dt = dt.replace(year=current_year)
                return dt
            except ValueError:
                continue

        nums = re.findall(r'\d+', date_str)
        if len(nums) >= 3:
            try:
                idx = 0
                year = int(nums[idx]) if len(nums[idx]) == 4 else current_year
                if len(nums[idx]) != 4:
                    month, day = int(nums[0]), int(nums[1])
                    hour = int(nums[2]) if len(nums) > 2 else 19
                    minute = int(nums[3]) if len(nums) > 3 else 0
                else:
                    month, day = int(nums[1]), int(nums[2])
                    hour = int(nums[3]) if len(nums) > 3 else 19
                    minute = int(nums[4]) if len(nums) > 4 else 0
                return datetime(year, month, day, hour, minute)
            except (ValueError, IndexError):
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

    def _extract_price(self, text: str, gender: str = 'male') -> Optional[int]:
        if gender == 'male':
            patterns = [r'남\s*[성자]?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*원',
                        r'남\s*(\d{1,3}(?:,\d{3})*|\d+)']
        else:
            patterns = [r'여\s*[성자]?\s*:?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*원',
                        r'여\s*(\d{1,3}(?:,\d{3})*|\d+)']

        for pat in patterns:
            match = re.search(pat, text.replace(' ', ''))
            if match:
                return int(match.group(1).replace(',', ''))

        # 공통 가격
        match = re.search(r'(\d{1,3}(?:,\d{3})*|\d+)원', text.replace(' ', ''))
        if match:
            return int(match.group(1).replace(',', ''))
        return None

    def _extract_ratio(self, text: str) -> Optional[str]:
        match = re.search(r'(\d+)\s*[:：]\s*(\d+)', text)
        if match:
            return f"{match.group(1)}:{match.group(2)}"
        return None

    def _extract_theme(self, text: str) -> list[str]:
        theme_map = {
            '와인': '와인', '커피': '커피', '에세이': '에세이',
            '전시': '전시', '사주': '사주', '보드게임': '보드게임', '쿠킹': '쿠킹',
        }
        themes = [t for k, t in theme_map.items() if k in text]
        return themes if themes else ['일반']

    def _extract_seats(self, text: str) -> Optional[int]:
        match = re.search(r'(\d+)\s*(?:석|자리|명)', text)
        if match:
            return int(match.group(1))
        return None
