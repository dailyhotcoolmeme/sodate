"""문토 (munto.kr) 스크래퍼 — Playwright 기반"""
import re
import time
from datetime import datetime
from typing import Optional
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

MUNTO_BASE_URL = 'https://munto.kr'
SEARCH_KEYWORDS = ['소개팅', '로테이션 미팅']
DATE_RE = re.compile(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})')
PRICE_RE = re.compile(r'([\d,]+)\s*원')
REGION_KW = ['강남', '홍대', '신촌', '잠실', '건대', '성수', '이태원', '합정', '여의도', '수원', '인천', '부산', '대구', '대전']


class MuntoScraper(BaseScraper):
    def __init__(self):
        super().__init__('munto')

    def scrape(self) -> list[EventModel]:
        events = []
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    ignore_https_errors=True,
                    user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                )
                page = context.new_page()

                for keyword in SEARCH_KEYWORDS:
                    try:
                        search_url = f'{MUNTO_BASE_URL}/search?keyword={keyword}'
                        page.goto(search_url, timeout=20000)
                        page.wait_for_load_state('networkidle', timeout=12000)
                        time.sleep(3)

                        # 클럽/모임 카드 링크 수집
                        links = page.eval_on_selector_all(
                            'a[href*="/clubs/"], a[href*="/meetings/"], a[href*="/groups/"]',
                            'els => [...new Set(els.map(e => e.href))].slice(0, 10)'
                        )
                        self.logger.info(f'문토 "{keyword}": {len(links)}개 링크 발견')

                        for link in links:
                            try:
                                page.goto(link, timeout=15000)
                                page.wait_for_load_state('networkidle', timeout=8000)
                                time.sleep(1)

                                title_el = page.query_selector('h1, h2')
                                title = title_el.inner_text().strip() if title_el else ''
                                if not title or not any(kw in title for kw in ['소개팅', '미팅', '로테이션']):
                                    continue

                                body_text = page.inner_text('body')

                                # 날짜
                                event_dates = []
                                for y, m, d in DATE_RE.findall(body_text):
                                    try:
                                        dt = datetime(int(y), int(m), int(d), 19, 0)
                                        if dt > datetime.now():
                                            event_dates.append(dt)
                                    except ValueError:
                                        pass

                                # 가격
                                raw_prices = [int(p.replace(',', '')) for p in PRICE_RE.findall(body_text)]
                                price_vals = sorted(set(v for v in raw_prices if 10000 <= v <= 200000))
                                price_male = price_vals[0] if price_vals else None
                                price_female = price_vals[1] if len(price_vals) > 1 else price_male

                                # 지역
                                region = '서울'
                                for r in REGION_KW:
                                    if r in body_text:
                                        region = r
                                        break

                                # 썸네일
                                imgs = page.eval_on_selector_all('img[src*="http"]', 'els => els.map(e => e.src)')
                                thumbnail = next((u for u in imgs if not u.endswith('.svg')), None)

                                for event_date in (event_dates[:3] or [datetime.now().replace(hour=19, minute=0, second=0, microsecond=0)]):
                                    events.append(EventModel(
                                        title=sanitize_text(f'[문토] {title}', 80),
                                        event_date=event_date,
                                        location_region=region,
                                        location_detail=None,
                                        price_male=price_male,
                                        price_female=price_female,
                                        gender_ratio=None,
                                        source_url=f'{link}#evt={event_date.strftime("%Y%m%d%H%M")}',
                                        thumbnail_urls=[thumbnail] if thumbnail else [],
                                        theme=['일반'],
                                        seats_left_male=None,
                                        seats_left_female=None,
                                    ))
                                time.sleep(1.5)
                            except Exception as e:
                                self.logger.warning(f'문토 클럽 파싱 실패 {link}: {e}')

                    except Exception as e:
                        self.logger.warning(f'문토 검색 실패 ({keyword}): {e}')

                browser.close()
        except Exception as e:
            self.logger.error(f'문토 크롤링 실패: {e}')

        seen: set[str] = set()
        unique = [ev for ev in events if ev.source_url not in seen and not seen.add(ev.source_url)]  # type: ignore
        self.logger.info(f'문토 총 {len(unique)}개 이벤트')
        return unique
