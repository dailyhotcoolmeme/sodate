"""이연시 (2yeonsi.com) 스크래퍼 — 광주 7:7 소개팅, Playwright"""
import re
import time
from datetime import datetime
from typing import Optional

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

# 3/28(토) 15:00 2F（ 낮 134기 95-02년생 ）*여2자리남음
DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})[（(][월화수목금토일][）)]\s*(\d{1,2}):(\d{2})')
CLOSED_RE = re.compile(r'모집종료|양쪽마감|남자마감.*여자마감|여자마감.*남자마감')


class TwoYeonsiScraper(BaseScraper):
    LIST_URL = 'https://2yeonsi.com/?idx=c66d7a938c66fb'
    BASE_URL = 'https://2yeonsi.com'

    def __init__(self):
        super().__init__('twoyeonsi')

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

                # 스크롤해서 전체 로드
                page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
                time.sleep(2)

                soup = BeautifulSoup(page.content(), 'html.parser')
                text = soup.get_text(separator='\n', strip=True)
                lines = [l.strip() for l in text.split('\n') if l.strip()]

                now = datetime.now()
                current_year = now.year
                seen: set[str] = set()

                for i, line in enumerate(lines):
                    date_m = DATE_RE.search(line)
                    if not date_m:
                        continue

                    mo, d = int(date_m.group(1)), int(date_m.group(2))
                    hour, minute = int(date_m.group(3)), int(date_m.group(4))

                    if not (1 <= mo <= 12 and 1 <= d <= 31):
                        continue

                    # 마감 여부 확인
                    if CLOSED_RE.search(line):
                        continue
                    # 남자마감+여자마감 모두 있으면 스킵
                    if '남자마감' in line and '여자마감' in line:
                        continue

                    try:
                        event_date = datetime(current_year, mo, d, hour, minute)
                        if event_date < now:
                            event_date = datetime(current_year + 1, mo, d, hour, minute)
                        if (event_date - now).days > 365:
                            continue
                    except ValueError:
                        continue

                    date_key = event_date.strftime('%Y%m%d%H%M')
                    if date_key in seen:
                        continue
                    seen.add(date_key)

                    # 회차/연령대 추출: 두 번째 괄호（ 낮 134기 95-02년생 ）
                    brackets = re.findall(r'[（(]([^）)]+)[）)]', line)
                    # 첫 번째는 요일(토/일 등), 두 번째가 회차 정보
                    subtitle = brackets[1].strip() if len(brackets) > 1 else (brackets[0].strip() if brackets else '')

                    # 마감 여부 재확인 (여자만 마감, 남자만 마감)
                    is_male_closed = '남자마감' in line
                    is_female_closed = '여자마감' in line

                    title = sanitize_text(f'[이연시] 광주 7:7 소개팅 {subtitle}', 80)
                    source_url = f'{self.BASE_URL}/?idx=c66d7a938c66fb#evt={date_key}'

                    try:
                        events.append(EventModel(
                            title=title,
                            event_date=event_date,
                            location_region='기타',  # 광주
                            location_detail='광주',
                            price_male=None,
                            price_female=None,
                            gender_ratio='7:7',
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
            self.logger.error(f'이연시 크롤링 실패: {e}')

        self.logger.info(f'이연시 총 {len(events)}개 이벤트')
        return events
