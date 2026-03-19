"""프립 (frip.co.kr) 스크래퍼 — P2 (동적/API 방식, 기본 구조)"""
import re
import time
import httpx
from datetime import datetime
from typing import Optional

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, sanitize_url

# 프립 비공개 API 엔드포인트 (실제 분석 후 업데이트 필요)
FRIP_SEARCH_API = 'https://api.frip.co.kr/products/search'
FRIP_BASE_URL = 'https://frip.co.kr'

# 소개팅 관련 검색 키워드
SEARCH_KEYWORDS = ['로테이션 소개팅', '소개팅', '미팅']


class FripScraper(BaseScraper):
    """
    프립은 동적 렌더링 + 자체 API를 사용합니다.
    실제 API 엔드포인트 및 파라미터는 브라우저 네트워크 탭 분석 후 업데이트 필요.
    현재는 기본 구조만 제공합니다.
    """

    def __init__(self):
        super().__init__('frip')

    def scrape(self) -> list[EventModel]:
        events = []
        for keyword in SEARCH_KEYWORDS:
            try:
                fetched = self._fetch_by_keyword(keyword)
                events.extend(fetched)
                time.sleep(1.0)
            except Exception as e:
                self.logger.warning(f"프립 키워드 '{keyword}' 조회 실패: {e}")
        # 중복 source_url 제거
        seen: set[str] = set()
        unique = []
        for ev in events:
            if ev.source_url not in seen:
                seen.add(ev.source_url)
                unique.append(ev)
        return unique

    def _fetch_by_keyword(self, keyword: str) -> list[EventModel]:
        """
        프립 API 호출 (실제 엔드포인트 분석 후 구현).
        현재는 stub으로 빈 리스트 반환.
        """
        self.logger.info(f"[frip] '{keyword}' 검색 중 (stub — API 분석 필요)")
        # TODO: 실제 API 엔드포인트 분석 후 구현
        # response = httpx.get(FRIP_SEARCH_API, params={'query': keyword, ...}, timeout=30)
        # response.raise_for_status()
        # data = response.json()
        # return [self._parse_item(item) for item in data.get('items', [])]
        return []

    def _parse_item(self, item: dict) -> Optional[EventModel]:
        """API 응답 아이템을 EventModel로 변환"""
        title = sanitize_text(item.get('title', ''))
        if not title:
            return None

        product_id = item.get('id') or item.get('productId')
        source_url = f"{FRIP_BASE_URL}/products/{product_id}" if product_id else None
        if not source_url:
            return None

        scheduled_at = item.get('scheduledAt') or item.get('startAt') or item.get('date')
        event_date = self._parse_date(str(scheduled_at)) if scheduled_at else None
        if not event_date:
            return None

        thumbnail = item.get('coverImageUrl') or item.get('imageUrl')
        price = item.get('price') or item.get('salePrice')

        return EventModel(
            external_id=str(product_id),
            title=title,
            description=sanitize_text(item.get('description'), 500),
            event_date=event_date,
            location_region=self._extract_region(item.get('location', '') + ' ' + title),
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
