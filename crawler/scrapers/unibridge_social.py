"""유니브리지소셜(unibridge_social) 스크래퍼 — 자체 사이트 없이 인스타 바이오에 걸린
구글폼(forms.gle) 링크들로 신청을 받는다. 각 폼의 초기 HTML에 박힌
FB_PUBLIC_LOAD_DATA_ JSON에서 '일정선택' 문항의 선택지를 회차별 이벤트로,
'참가비 안내' 문항에서 성별 가격을 뽑는다(2026-08-11, 정식 부여 방식 없이도
가격까지 확보되는 드문 케이스). 폼 자체는 로그인·JS렌더링 불필요 — httpx만으로 충분.
바이오에서 forms.gle 링크를 걷어올 때만 인스타 특성상 실제 Chrome이 필요."""
import json
import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

import httpx
from playwright.sync_api import sync_playwright

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.region import resolve_region

PROFILE_URL = 'https://www.instagram.com/unibridge_social/'

# "8/15(토) 합정 [오후 2시] 🅰️올데이🅰️ 99~07 ..." — 앞에 붙는 이모지/체크마크는 무시하고 검색.
_SCHEDULE_ITEM_RE = re.compile(r'(\d{1,2})/(\d{1,2})\([가-힣]\)\s*([가-힣]+)\s*\[([^\]]+)\]')
_AGE_RANGE_RE = re.compile(r'\b(\d{2})~(\d{2})\b')
_HOUR_RE = re.compile(r'(\d{1,2})시')
# "남자일시마감"/"남자 일시적 마감"처럼 한쪽 성별만 찬 경우는 전체 마감이 아니다(다른 성별은 신청 가능).
_PARTIAL_CLOSE_RE = re.compile(r'(남자|여자)\s*(일시적?)?\s*마감')


def _parse_kor_hour(phrase: str) -> Optional[int]:
    m = _HOUR_RE.search(phrase)
    if not m:
        return None
    h = int(m.group(1))
    if '오전' in phrase:
        return 0 if h == 12 else h
    return 12 if h == 12 else h + 12  # 오후/저녁/밤 전부 PM 취급


def _year_for(yy: int) -> int:
    return 2000 + yy if yy <= 30 else 1900 + yy


class UnibridgeSocialScraper(BaseScraper):
    # 폼 '참가비 안내' 문항에서 남/여 실제 참가비를 직접 파싱 → 정본으로 채운다.
    WRITES_PRICE = True

    def __init__(self):
        super().__init__('unibridge-social')

    def scrape(self) -> list[EventModel]:
        form_urls = self._active_form_urls()
        if not form_urls:
            self.logger.warning('유니브리지소셜 활성 폼을 하나도 못 찾음')
            return []

        events: list[EventModel] = []
        now = datetime.now()

        for form_url in form_urls:
            try:
                r = httpx.get(form_url, timeout=20, follow_redirects=True)
                m = re.search(r'var FB_PUBLIC_LOAD_DATA_ = (\[.*?\]);', r.text, re.S)
                if not m:
                    continue
                items = json.loads(m.group(1))[1][1]
            except Exception as e:
                self.logger.warning(f'폼 파싱 실패 {form_url}: {e}')
                continue

            schedule_item = next((it for it in items if it[1] == '일정선택'), None)
            price_item = next((it for it in items if it[1] == '참가비 안내'), None)
            if not schedule_item:
                continue

            price_male = price_female = None
            if price_item and price_item[2]:
                pm = re.search(r'Male[^\d]*?([\d,]+)\s*원', price_item[2], re.S)
                pf = re.search(r'Female[^\d]*?([\d,]+)\s*원', price_item[2], re.S)
                if pm:
                    price_male = int(pm.group(1).replace(',', ''))
                if pf:
                    price_female = int(pf.group(1).replace(',', ''))

            try:
                options = schedule_item[4][0][1]
            except Exception:
                continue

            for opt in options:
                text = opt[0] if opt else ''
                sm = _SCHEDULE_ITEM_RE.search(text)
                if not sm:
                    continue  # 구분선("--------") 등은 매칭 안 되어 자동으로 걸러짐
                month, day = int(sm.group(1)), int(sm.group(2))
                region_raw = sm.group(3).strip()
                hour = _parse_kor_hour(sm.group(4))
                if hour is None or not (1 <= month <= 12 and 1 <= day <= 31):
                    continue

                try:
                    event_date = datetime(now.year, month, day, hour, 0)
                except ValueError:
                    continue
                if event_date < now.replace(hour=0, minute=0, second=0, microsecond=0):
                    event_date = datetime(now.year + 1, month, day, hour, 0)

                region = resolve_region(region_phrase=region_raw)
                is_closed = '마감' in text and not _PARTIAL_CLOSE_RE.search(text)

                age_range_min = age_range_max = None
                age_male = age_female = None
                am = _AGE_RANGE_RE.search(text)
                if am:
                    y1, y2 = _year_for(int(am.group(1))), _year_for(int(am.group(2)))
                    lo, hi = min(y1, y2), max(y1, y2)
                    age_range_max = now.year - lo
                    age_range_min = now.year - hi
                    # 남녀 공통 연령대(세션 타입 기준) — 앱 상세페이지의 가격 옆 나이 표시는
                    # age_male/age_female을 봐서, 안 채우면 가격만 뜨고 나이는 안 보인다.
                    age_male = age_female = f'{age_range_min}~{age_range_max}'

                # 폼 하나에 여러 회차가 섞여있어 회차 식별용 fragment로 유일성 확보(다른 스크래퍼와 동일 관례).
                # 아웃링크는 신청폼이 아니라 인스타 본계정으로(오너 지시 2026-08-11).
                frag = f'e={month:02d}{day:02d}_{hour:02d}00_{quote(region_raw)}'
                title = sanitize_text(f'[유니브리지소셜] {region} 로테이션 소개팅', 80)

                try:
                    events.append(EventModel(
                        title=title,
                        event_date=event_date,
                        location_region=region,
                        source_url=f'{PROFILE_URL}#{frag}',
                        is_closed=is_closed,
                        price_male=price_male,
                        price_female=price_female,
                        age_range_min=age_range_min,
                        age_range_max=age_range_max,
                        age_male=age_male,
                        age_female=age_female,
                    ))
                except Exception as e:
                    self.logger.warning(f'유니브리지소셜 이벤트 생성 실패 {text!r}: {e}')

        self.logger.info(f'유니브리지소셜 {len(events)}개 이벤트 파싱')
        return events

    def _active_form_urls(self) -> list[str]:
        """바이오의 forms.gle 링크 중 마감(closedform)이 아닌 것만 최종 URL로 반환."""
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, channel='chrome', args=['--no-sandbox'])
                context = browser.new_context(locale='ko-KR', viewport={'width': 390, 'height': 844},
                    user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
                               '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
                page = context.new_page()
                page.goto(PROFILE_URL, timeout=30000, wait_until='domcontentloaded')
                page.wait_for_timeout(4000)
                html = page.content()
                browser.close()
        except Exception as e:
            self.logger.error(f'유니브리지소셜 인스타 프로필 로드 실패: {e}')
            return []

        short_links = sorted(set(re.findall(r'https://forms\.gle/[A-Za-z0-9]+', html)))
        active = []
        for link in short_links:
            try:
                r = httpx.get(link, follow_redirects=True, timeout=15)
                final = str(r.url)
                if 'closedform' in final:
                    continue
                active.append(final)
            except Exception as e:
                self.logger.warning(f'폼 링크 확인 실패 {link}: {e}')
        return active
