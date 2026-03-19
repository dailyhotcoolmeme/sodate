"""러브매칭 (lovematching.kr) 스크래퍼"""
import re
import time
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.image_extractor import extract_images, extract_og_image
from utils.security import sanitize_text, sanitize_url


class LoveMatchingScraper(BaseScraper):
    BASE_URL = 'https://lovematching.kr'
    SCHEDULE_URL = 'https://lovematching.kr/schedule'

    def __init__(self):
        super().__init__('lovematching')

    def scrape(self) -> list[EventModel]:
        response = httpx.get(self.SCHEDULE_URL, timeout=30, follow_redirects=True)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        events = []
        # 일정 카드 셀렉터 — 실제 HTML 구조에 맞게 조정 필요
        cards = soup.select(
            '.schedule-item, .event-card, .program-item, '
            '[class*="schedule"], [class*="event"], [class*="program"]'
        )

        if not cards:
            # fallback: 링크 기반 탐색
            cards = [
                a.parent for a in soup.select('a[href*="/schedule/"], a[href*="/event/"]')
            ]

        for card in cards:
            try:
                event = self._parse_card(card)
                if event:
                    events.append(event)
                    time.sleep(0.5)  # 카드별 딜레이
            except Exception as e:
                self.logger.warning(f"카드 파싱 실패: {e}")

        return events

    def _parse_card(self, card) -> Optional[EventModel]:
        title_el = card.select_one('[class*="title"], h2, h3, h4, strong')
        date_el = card.select_one('[class*="date"], time, [class*="time"]')
        link_el = card.select_one('a[href]')
        img_el = card.select_one('img')
        price_el = card.select_one('[class*="price"], [class*="fee"]')

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

        thumbnail_urls = []
        if img_el and img_el.get('src'):
            img_url = sanitize_url(img_el.get('src'), self.BASE_URL)
            if img_url:
                thumbnail_urls = [img_url]

        price_text = price_el.get_text(strip=True) if price_el else ''

        return EventModel(
            title=title,
            event_date=event_date,
            location_region=self._extract_region(title),
            price_male=self._extract_price(price_text),
            price_female=self._extract_price(price_text),
            source_url=source_url,
            thumbnail_urls=thumbnail_urls,
            theme=self._extract_theme(title),
            gender_ratio=self._extract_ratio(title),
        )

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        date_str = date_str.strip()
        formats = [
            '%Y.%m.%d %H:%M',
            '%Y-%m-%d %H:%M',
            '%Y/%m/%d %H:%M',
            '%Y.%m.%d',
            '%m/%d %H:%M',
            '%m월 %d일 %H:%M',
            '%m월 %d일',
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

        # 숫자만 추출 후 시도
        nums = re.findall(r'\d+', date_str)
        if len(nums) >= 3:
            try:
                year = int(nums[0]) if len(nums[0]) == 4 else current_year
                month = int(nums[0] if len(nums[0]) == 2 else nums[1])
                day = int(nums[1] if len(nums[0]) == 2 else nums[2])
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

    def _extract_price(self, text: str) -> Optional[int]:
        match = re.search(r'(\d{1,3}(?:,\d{3})*|\d+)원', text.replace(' ', ''))
        if match:
            return int(match.group(1).replace(',', ''))
        return None

    def _extract_theme(self, text: str) -> list[str]:
        theme_map = {
            '와인': '와인', '커피': '커피', '에세이': '에세이',
            '전시': '전시', '사주': '사주', '보드게임': '보드게임',
            '쿠킹': '쿠킹', '요리': '쿠킹',
        }
        themes = [theme for keyword, theme in theme_map.items() if keyword in text]
        return themes if themes else ['일반']

    def _extract_ratio(self, text: str) -> Optional[str]:
        match = re.search(r'(\d+)\s*[:：]\s*(\d+)', text)
        if match:
            return f"{match.group(1)}:{match.group(2)}"
        return None
