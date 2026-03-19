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


class YeoninScraper(BaseScraper):
    BASE_URL = 'https://yeonin.co.kr'
    SCHEDULE_URL = 'https://yeonin.co.kr/schedule'

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

                # 2단계: 최신 게시물 최대 3개만 파싱
                for title, url in post_links[:3]:
                    try:
                        page.goto(url, timeout=15000)
                        page.wait_for_load_state('networkidle', timeout=8000)
                        content_text = page.inner_text('body')
                        thumbnail_url = None
                        imgs = page.eval_on_selector_all('img[src*="cdn.imweb"]', 'els => els.map(e => e.src)')
                        if imgs:
                            thumbnail_url = imgs[0]

                        parsed = self._parse_post(title, content_text, url, thumbnail_url)
                        events.extend(parsed)
                        time.sleep(1)
                    except Exception as e:
                        self.logger.warning(f'게시물 파싱 실패 {url}: {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'크롤링 실패: {e}')
            raise

        return events

    def _parse_post(self, post_title: str, content: str, source_url: str, thumbnail_url: Optional[str]) -> list[EventModel]:
        """월별 일정 게시물 텍스트에서 개별 이벤트 추출"""
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
        region_keywords = ['강남', '홍대', '신촌', '잠실', '건대', '성수', '수원', '인천', '부산', '대구', '대전']

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
                    seats_left_male=None,
                    seats_left_female=None,
                ))

            except (ValueError, IndexError):
                continue

        return events
