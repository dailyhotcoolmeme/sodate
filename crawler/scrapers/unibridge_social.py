"""유니브리지소셜(unibridge_social) 스크래퍼 — 자체 사이트 없이 구글폼(forms.gle)으로
신청을 받는다. 각 폼의 초기 HTML에 박힌 FB_PUBLIC_LOAD_DATA_ JSON에서 '일정선택'
문항의 선택지를 회차별 이벤트로, '참가비 안내' 문항에서 성별 가격을 뽑는다
(2026-08-11, 정식 부여 방식 없이도 가격까지 확보되는 드문 케이스).

⚠️ 폼 링크 수집처를 인스타 바이오 → 링크 모음(litt.ly)으로 옮겼다(2026-08-14).
   두 가지가 겹쳐서 8/11 이후 3일간 수집 0건이었고, 9월 일정 22건이 통째로 앱에
   안 들어갔다:
     1) 인스타가 비로그인 프로필 접근을 막았다(Actions에서 ERR_HTTP_RESPONSE_CODE_FAILURE,
        로컬에서도 바이오 없는 로그인 월만 옴).
     2) 설령 바이오를 읽었어도 0건이었다 — 업체가 바이오 링크를 forms.gle에서
        litt.ly로 바꿨는데 우리는 바이오에서 forms.gle만 찾고 있었다.
   litt.ly는 로그인·브라우저 없이 httpx만으로 읽힌다(단, UA 함정은 _active_form_urls 주석 참고).
   아웃링크(source_url)는 기존대로 인스타 본계정으로 보낸다(오너 지시 2026-08-11)."""
import json
import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.region import resolve_region

PROFILE_URL = 'https://www.instagram.com/unibridge_social/'   # 아웃링크 전용(수집엔 안 씀)
# 신청폼 링크가 모여 있는 곳. 업체가 여기 구조를 또 바꾸면 수집이 0건이 되는데,
# 그때는 _active_form_urls가 ERROR를 남기고 워치독 긴급 알림이 잡는다.
LINK_HUB_URL = 'https://litt.ly/unibridge_social'
# 이 업체는 회차별 실제 사진이 없어(구글폼 텍스트 문항만 파싱) 피드 썸네일·상세 상단
# 이미지가 전부 비어 있었다. 업체 로고를 기본 썸네일로 고정한다(오너 지시 2026-08-13).
DEFAULT_THUMBNAIL = 'https://sodate-admin.pages.dev/media/thumbnails/unibridge-social/logo-thumb.webp'

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
    # 구글폼의 '일정선택' 문항이 곧 전체 일정 정본이라(업체가 회차를 내리면 선택지에서
    # 바로 사라진다) 이번 크롤에 없는 회차는 지워도 안전하다. 켜기 전엔 내려간 회차가
    # 계속 남아 있었다(2026-08-14: 8/15 합정·8/19 건대가 폼에서 빠졌는데도 앱에 노출).
    # base_scraper의 50% 부분실패 안전장치는 그대로 걸린다.
    DELETE_STALE = True

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
                        thumbnail_urls=[DEFAULT_THUMBNAIL],
                    ))
                except Exception as e:
                    self.logger.warning(f'유니브리지소셜 이벤트 생성 실패 {text!r}: {e}')

        self.logger.info(f'유니브리지소셜 {len(events)}개 이벤트 파싱')
        return events

    def _active_form_urls(self) -> list[str]:
        """링크 모음(litt.ly)의 forms.gle 링크 중 마감(closedform)이 아닌 것만 최종 URL로 반환."""
        try:
            # ⚠️ User-Agent를 붙이면 안 된다. litt.ly가 UA를 보고 JS 렌더링용 껍데기 HTML을
            #    돌려줘서 링크가 통째로 사라진다(2026-08-14 실측: Chrome UA → forms.gle 0건,
            #    UA 없음 → 3건). 아래 폼 조회도 같은 이유로 UA 없이 간다.
            r = httpx.get(LINK_HUB_URL, timeout=20, follow_redirects=True)
            r.raise_for_status()
            html = r.text
        except Exception as e:
            self.logger.error(f'유니브리지소셜 링크 모음 로드 실패({LINK_HUB_URL}): {e}')
            return []

        short_links = sorted(set(re.findall(r'https://forms\.gle/[A-Za-z0-9_-]+', html)))
        if not short_links:
            # 업체가 링크 구조를 또 바꾼 상황. 조용히 0건으로 끝나면 이번처럼 며칠씩 모른다.
            self.logger.error(
                f'유니브리지소셜 링크 모음에 신청폼이 하나도 없음 — 업체가 링크를 또 바꿨는지 확인 필요({LINK_HUB_URL})'
            )
            return []

        active = []
        for link in short_links:
            try:
                r = httpx.get(link, follow_redirects=True, timeout=15)
                r.raise_for_status()
                final = str(r.url)
                if 'closedform' in final:
                    continue
                active.append(final)
            except Exception as e:
                self.logger.warning(f'폼 링크 확인 실패 {link}: {e}')
        return active
