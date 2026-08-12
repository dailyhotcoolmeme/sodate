"""오프더레코드(otr.lounge_) 스크래퍼 — 자체 사이트 없이 인스타로만 운영, 바이오에
일정이 직접 적혀 있다(finance_lounge.py와 동일 패턴). 신청은 별도 계정
@otr.lounge_apply로 안내되지만, 아웃링크는 본계정(@otr.lounge_)으로 보낸다
(오너 지시 2026-08-11 — 신청페이지로 바로 보내지 말고 인스타 계정으로)."""
import re
from datetime import datetime
from urllib.parse import quote

from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.region import resolve_region

PROFILE_URL = 'https://www.instagram.com/otr.lounge_/'

# "8.14 20:00 을지로 (마감)" / "8.17 13:00 종로" / "8.17 16:30 종로"
_SCHEDULE_RE = re.compile(
    r'^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([가-힣]+)\s*(?:\(([^)]*)\))?\s*$'
)


class OtrLoungeScraper(BaseScraper):
    def __init__(self):
        super().__init__('otr-lounge')

    def scrape(self) -> list[EventModel]:
        bio = self._fetch_bio()
        if not bio:
            self.logger.warning('오프더레코드 바이오를 못 가져옴')
            return []

        events: list[EventModel] = []
        now = datetime.now()

        for line in bio.splitlines():
            line = line.strip()
            m = _SCHEDULE_RE.match(line)
            if not m:
                continue

            month, day, hour, minute = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            region_raw = m.group(5).strip()
            note = (m.group(6) or '').strip()
            if not (1 <= month <= 12 and 1 <= day <= 31 and 0 <= hour <= 23):
                continue

            try:
                event_date = datetime(now.year, month, day, hour, minute)
            except ValueError:
                continue
            if event_date < now.replace(hour=0, minute=0, second=0, microsecond=0):
                event_date = datetime(now.year + 1, month, day, hour, minute)

            region = resolve_region(region_phrase=region_raw)
            is_closed = '마감' in note

            frag = f'e={month:02d}{day:02d}_{hour:02d}{minute:02d}_{quote(region_raw)}'
            title = sanitize_text(f'[오프더레코드] {region} 로테이션 소개팅', 80)
            description = sanitize_text(note, 1000) if note else None

            try:
                events.append(EventModel(
                    title=title,
                    description=description,
                    event_date=event_date,
                    location_region=region,
                    source_url=f'{PROFILE_URL}#{frag}',
                    is_closed=is_closed,
                ))
            except Exception as e:
                self.logger.warning(f'오프더레코드 이벤트 생성 실패 {line!r}: {e}')

        self.logger.info(f'오프더레코드 {len(events)}개 이벤트 파싱')
        return events

    def _fetch_bio(self) -> str:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, channel='chrome', args=['--no-sandbox'])
                context = browser.new_context(locale='ko-KR', viewport={'width': 390, 'height': 844},
                    user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
                               '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
                page = context.new_page()
                page.goto(PROFILE_URL, timeout=30000, wait_until='domcontentloaded')
                page.wait_for_timeout(4000)
                try:
                    page.get_by_text('더 보기', exact=False).first.click(timeout=2000)
                    page.wait_for_timeout(1000)
                except Exception:
                    pass
                text = page.inner_text('body')
                browser.close()
                return text
        except Exception as e:
            self.logger.error(f'오프더레코드 인스타 프로필 로드 실패: {e}')
            return ''
