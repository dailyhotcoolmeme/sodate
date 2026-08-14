"""오프더레코드(otr.lounge_) 스크래퍼 — 자체 사이트 없이 링크 모음(linkfly)에 일정이
버튼 목록으로 걸려 있다. 신청은 별도 네이버폼으로 안내되지만, 아웃링크는 인스타
본계정(@otr.lounge_)으로 보낸다(오너 지시 2026-08-11 — 신청페이지로 바로 보내지 말 것).

⚠️ 일정 출처를 인스타 바이오 → linkfly로 옮겼다(2026-08-14). 인스타가 비로그인 프로필
   접근을 막아 8/11 이후 수집이 계속 0건이었고(Actions에서 ERR_HTTP_RESPONSE_CODE_FAILURE),
   그동안 마감된 회차가 '신청 가능'으로 남고 신규 회차는 아예 안 들어왔다.
   linkfly는 페이지 자체는 JS 렌더링이지만 내용이 통째로 JSON 한 벌로 내려와서
   브라우저 없이 httpx만으로 읽힌다(fly.linkcdn.cc). 바이오보다 오히려 더 완전하다 —
   바이오는 인스타가 '...'로 잘라 보내서 뒷 회차가 안 보였다.

⚠️ 지역: linkfly 버튼에는 지명이 없다(바이오에만 있었다). 노션·네이버폼·인스타 게시물까지
   확인했지만 회차별 지역을 얻을 방법이 없다. 이 업체는 종로·을지로만 운영하고 둘을
   하나의 지명으로 봐도 무방하다는 오너 확인(2026-08-14)에 따라 REGION 고정값을 쓴다.
"""
import json
import re
from datetime import datetime

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text

PROFILE_URL = 'https://www.instagram.com/otr.lounge_/'   # 아웃링크 전용(수집엔 안 씀)
LINK_HUB_URL = 'https://linkfly.to/offtherecord'
# linkfly 본문이 담긴 JSON. 페이지 HTML의 "bio":{"id":"..."} 에서 이 id를 뽑아 조립한다.
LINK_JSON_URL = 'https://fly.linkcdn.cc/upload/lnkcmpts/{linkid}.json'
_LINKID_RE = re.compile(r'"bio"\s*:\s*\{\s*"id"\s*:\s*"([A-Za-z0-9]+)"')

# 바이오 텍스트만 파싱해 회차별 실제 사진이 없어 피드 썸네일·상세 상단 이미지가
# 비어 있었다. 업체 로고를 기본 썸네일로 고정한다(오너 지시 2026-08-13).
DEFAULT_THUMBNAIL = 'https://sodate-admin.pages.dev/media/thumbnails/otr-lounge/logo-thumb.webp'

# 종로·을지로만 운영하며 둘을 한 지명으로 취급해도 된다(오너 확인 2026-08-14).
# 앱 지역 칩은 events.location_region 값을 그대로 모아 만들기 때문에 이 값이 곧 칩이 된다.
REGION = '종로/을지로'

# "💌 [신청] 8.17(월) 13:00" / "💌 [신청] 8.17(월) 16:30(마감)"
_SCHEDULE_RE = re.compile(
    r'(\d{1,2})\.(\d{1,2})\s*\([월화수목금토일]\)\s*(\d{1,2}):(\d{2})\s*(?:\(([^)]*)\))?'
)


class OtrLoungeScraper(BaseScraper):
    # linkfly 버튼 목록이 곧 전체 일정 정본이라(업체가 회차를 내리면 버튼도 사라진다)
    # 이번 크롤에 없는 회차는 지워도 안전하다. 유니브리지소셜과 같은 이유이며, 지역
    # 표기 변경으로 옛 source_url 행이 남아 앱에 중복 노출되는 것도 이걸로 정리된다.
    # base_scraper의 50% 부분실패 안전장치는 그대로 걸린다.
    DELETE_STALE = True

    def __init__(self):
        super().__init__('otr-lounge')

    def scrape(self) -> list[EventModel]:
        buttons = self._fetch_buttons()
        if not buttons:
            return []

        events: list[EventModel] = []
        now = datetime.now()
        seen: set[str] = set()

        for label in buttons:
            m = _SCHEDULE_RE.search(label)
            if not m:
                continue   # 인스타·카카오 등 일정이 아닌 버튼

            month, day, hour, minute = (int(m.group(1)), int(m.group(2)),
                                        int(m.group(3)), int(m.group(4)))
            note = (m.group(5) or '').strip()
            if not (1 <= month <= 12 and 1 <= day <= 31 and 0 <= hour <= 23):
                continue

            try:
                event_date = datetime(now.year, month, day, hour, minute)
            except ValueError:
                continue
            if event_date < now.replace(hour=0, minute=0, second=0, microsecond=0):
                event_date = datetime(now.year + 1, month, day, hour, minute)

            # 회차 식별은 날짜·시각만으로 한다. 예전엔 지역까지 넣었는데, 지역 표기가
            # 바뀌는 순간(이번에 '종로'→'종로/을지로') source_url이 달라져 같은 회차가
            # 새 행으로 들어오고 옛 행이 그대로 남아 앱에 두 번 보인다.
            frag = f'e={month:02d}{day:02d}_{hour:02d}{minute:02d}'
            if frag in seen:
                continue
            seen.add(frag)

            events.append(EventModel(
                title=sanitize_text(f'[오프더레코드] {REGION} 로테이션 소개팅', 80),
                description=sanitize_text(note, 1000) if note else None,
                event_date=event_date,
                location_region=REGION,
                source_url=f'{PROFILE_URL}#{frag}',
                is_closed='마감' in note,
                thumbnail_urls=[DEFAULT_THUMBNAIL],
            ))

        self.logger.info(f'오프더레코드 {len(events)}개 이벤트 파싱')
        return events

    def _fetch_buttons(self) -> list[str]:
        """linkfly 본문 JSON에서 버튼 라벨을 전부 걷어온다."""
        try:
            r = httpx.get(LINK_HUB_URL, timeout=20, follow_redirects=True)
            r.raise_for_status()
        except Exception as e:
            self.logger.error(f'오프더레코드 링크 모음 로드 실패({LINK_HUB_URL}): {e}')
            return []

        lm = _LINKID_RE.search(r.text)
        if not lm:
            self.logger.error(
                f'오프더레코드 링크 모음에서 콘텐츠 id를 못 찾음 — linkfly가 구조를 바꿨는지 확인 필요({LINK_HUB_URL})'
            )
            return []

        try:
            jr = httpx.get(LINK_JSON_URL.format(linkid=lm.group(1)), timeout=20, follow_redirects=True)
            jr.raise_for_status()
            data = jr.json()
            contents = data.get('contents')
            comps = json.loads(contents) if isinstance(contents, str) else (contents or [])
        except Exception as e:
            self.logger.error(f'오프더레코드 링크 모음 본문 파싱 실패: {e}')
            return []

        labels = [
            (b.get('title') or '').strip()
            for comp in comps
            for b in (comp.get('buttons') or [])
            if (b.get('title') or '').strip()
        ]
        if not labels:
            # 조용히 0건으로 끝나면 이번처럼 며칠씩 모른다 → 워치독 긴급 알림에 걸리게 ERROR.
            self.logger.error(f'오프더레코드 링크 모음에 버튼이 하나도 없음({LINK_HUB_URL})')
        return labels
