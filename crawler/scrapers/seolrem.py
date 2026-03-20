"""설렘한편 (seolrem1.com) 스크래퍼 — 광주 소개팅, Playwright + jQuery FullCalendar"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

TIME_RE = re.compile(r'(\d{1,2}):(\d{2})')


class SeolremScraper(BaseScraper):
    LIST_URL = 'https://seolrem1.com/currentopening'
    BASE_URL = 'https://seolrem1.com'

    def __init__(self):
        super().__init__('seolrem')

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
                page.goto(self.LIST_URL, timeout=20000)
                page.wait_for_load_state('domcontentloaded', timeout=10000)
                time.sleep(3)

                # jQuery FullCalendar API로 이벤트 데이터 가져오기
                raw_events = page.evaluate('''() => {
                    try {
                        const cal = document.querySelector(".fc");
                        if (!cal || typeof jQuery === "undefined") return [];
                        const evts = jQuery(cal).fullCalendar("clientEvents");
                        return evts.map(e => ({
                            title: e.title || "",
                            start: e.start ? e.start.format("YYYY-MM-DD") : null,
                        }));
                    } catch(e) {
                        return [];
                    }
                }''')

                self.logger.info(f'설렘한편 캘린더 이벤트 {len(raw_events)}개 수집')

                now = datetime.now()
                seen: set[str] = set()

                for item in raw_events:
                    title = item.get('title', '').strip()
                    start = item.get('start')
                    if not title or not start:
                        continue

                    # 시간 추출 (제목에서: "20:00~", "18:00~")
                    hour, minute = 19, 0
                    time_m = TIME_RE.search(title)
                    if time_m:
                        hour, minute = int(time_m.group(1)), int(time_m.group(2))

                    try:
                        y, mo, d = [int(x) for x in start.split('-')]
                        event_date = datetime(y, mo, d, hour, minute)
                    except (ValueError, AttributeError):
                        continue

                    if event_date < now:
                        continue
                    if (event_date - now).days > 180:
                        continue

                    date_key = event_date.strftime('%Y%m%d%H%M')
                    if date_key in seen:
                        continue
                    seen.add(date_key)

                    # 제목 정리 (시간, 커플수 제거 → 연령대 남김)
                    clean = re.sub(r'\d+커플💘', '', title)
                    clean = re.sub(r'\d{2}:\d{2}~?', '', clean).strip()
                    clean = re.sub(r'[💘✨✝️🚭]', '', clean).strip()

                    source_url = f'{self.BASE_URL}/currentopening#evt={date_key}'
                    ev_title = sanitize_text(f'[설렘한편] 광주 소개팅 {clean}', 80)

                    try:
                        events.append(EventModel(
                            title=ev_title,
                            event_date=event_date,
                            location_region='기타',  # 광주
                            location_detail='광주',
                            price_male=None,
                            price_female=None,
                            gender_ratio=None,
                            source_url=source_url,
                            thumbnail_urls=[],
                            theme=['일반'],
                            seats_left_male=None,
                            seats_left_female=None,
                        ))
                    except Exception:
                        continue

                browser.close()
        except Exception as e:
            self.logger.error(f'설렘한편 크롤링 실패: {e}')

        self.logger.info(f'설렘한편 총 {len(events)}개 이벤트')
        return events
