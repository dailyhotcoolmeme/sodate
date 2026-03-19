"""문토 (munto.kr) 스크래퍼 — P2 (동적 JS 렌더링, 기본 구조)"""
import re
import time
from datetime import datetime
from typing import Optional

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url

MUNTO_BASE_URL = 'https://munto.kr'
MUNTO_SEARCH_URL = 'https://munto.kr/search'

SEARCH_KEYWORDS = ['소개팅', '로테이션', '미팅']


class MuntoScraper(BaseScraper):
    """
    문토는 Next.js 기반 동적 렌더링 사이트입니다.
    Playwright를 사용한 실제 크롤링은 브라우저 실행 환경 필요.
    현재는 기본 구조만 제공합니다.

    구현 방향:
    1. playwright.sync_api로 브라우저 실행
    2. 소개팅 키워드로 검색
    3. 카드 목록 파싱
    """

    def __init__(self):
        super().__init__('munto')

    def scrape(self) -> list[EventModel]:
        events = []
        for keyword in SEARCH_KEYWORDS:
            try:
                fetched = self._scrape_keyword(keyword)
                events.extend(fetched)
                time.sleep(2.0)  # 동적 사이트 — 더 긴 딜레이
            except Exception as e:
                self.logger.warning(f"문토 키워드 '{keyword}' 크롤링 실패: {e}")

        # 중복 제거
        seen: set[str] = set()
        unique = []
        for ev in events:
            if ev.source_url not in seen:
                seen.add(ev.source_url)
                unique.append(ev)
        return unique

    def _scrape_keyword(self, keyword: str) -> list[EventModel]:
        """
        Playwright를 사용한 동적 크롤링 (stub).
        실제 구현 시 playwright.sync_api 사용.
        """
        self.logger.info(f"[munto] '{keyword}' 검색 중 (stub — Playwright 구현 필요)")
        # TODO: Playwright 구현
        # from playwright.sync_api import sync_playwright
        # with sync_playwright() as p:
        #     browser = p.chromium.launch(headless=True)
        #     page = browser.new_page()
        #     page.goto(f"{MUNTO_SEARCH_URL}?q={keyword}")
        #     page.wait_for_selector('.club-card', timeout=10000)
        #     cards = page.query_selector_all('.club-card')
        #     events = [self._parse_card(card) for card in cards]
        #     browser.close()
        #     return [e for e in events if e]
        return []

    def _parse_card_data(self, data: dict) -> Optional[EventModel]:
        """카드 데이터를 EventModel로 변환"""
        title = sanitize_text(data.get('title', ''))
        if not title:
            return None

        club_id = data.get('id') or data.get('clubId')
        source_url = f"{MUNTO_BASE_URL}/clubs/{club_id}" if club_id else None
        if not source_url:
            return None

        event_date_str = data.get('nextSessionAt') or data.get('scheduledAt')
        event_date = self._parse_date(str(event_date_str)) if event_date_str else None
        if not event_date:
            return None

        thumbnail = data.get('coverUrl') or data.get('imageUrl')
        price = data.get('price') or data.get('fee')

        return EventModel(
            external_id=str(club_id),
            title=title,
            description=sanitize_text(data.get('description'), 500),
            event_date=event_date,
            location_region=self._extract_region(data.get('location', '') + ' ' + title),
            price_male=int(price) if price else None,
            price_female=int(price) if price else None,
            source_url=source_url,
            thumbnail_urls=[thumbnail] if thumbnail else [],
            theme=self._extract_theme(title),
        )

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        formats = [
            '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%SZ',
            '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d',
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str[:19], fmt)
            except ValueError:
                continue
        return None

    def _extract_region(self, text: str) -> str:
        regions = ['강남', '역삼', '선릉', '홍대', '신촌', '연남', '을지로', '종로',
                   '잠실', '건대', '성수', '이태원', '한남', '수원', '판교', '분당',
                   '인천', '대전']
        for region in regions:
            if region in text:
                return region
        return '기타'

    def _extract_theme(self, text: str) -> list[str]:
        theme_map = {
            '와인': '와인', '커피': '커피', '에세이': '에세이',
            '전시': '전시', '사주': '사주', '보드게임': '보드게임', '쿠킹': '쿠킹',
        }
        themes = [t for k, t in theme_map.items() if k in text]
        return themes if themes else ['일반']
