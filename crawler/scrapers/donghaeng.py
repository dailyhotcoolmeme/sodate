"""동행클럽 (donghaeng.club, 넷플연가 후신) 스크래퍼 — 문화생활 살롱 소셜링

무인증 공개 REST JSON API:
  GET api.donghaeng.club/v2/nfyg/meetups?type={T}&upcoming=true&limit=32&offset={N}
type 순회: 1·2·3·5 (4는 없음). 다회차 시즌 프로그램이라 '첫(가장 이른 미래) 세션'을 대표 날짜로 쓴다.

event_type='socialing'. socialing_category = salonCategory(일과 커리어/라이프스타일 등).
성비 필드(femaleCapacity/maleCapacity)가 스키마에 있으나 대개 null → 있으면만 채운다.
정원은 성별 없는 총원(maxCapacity/attendeeCount) → participant_stats 에 담는다.
"""
import re
import time
from datetime import datetime, timezone, timedelta

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text, format_donghaeng_desc
from utils.date_filter import is_within_one_month

KST = timezone(timedelta(hours=9))

DH_WEB = 'https://donghaeng.club'
DH_API = 'https://api.donghaeng.club/v2/nfyg/meetups'
TYPES = [1, 2, 3, 5]
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://donghaeng.club/',
}


class DonghaengScraper(BaseScraper):
    WRITES_PRICE = True
    WRITES_SEATS = True    # 총원 정원/참가(성별 아님) — participant_stats + is_closed 로 반영
    WRITES_AGE = False
    DELETE_STALE = True

    def __init__(self):
        super().__init__('donghaeng')

    @staticmethod
    def _parse_iso(s):
        """'2026-10-18T14:00:00+09:00' → naive KST datetime."""
        if not s:
            return None
        try:
            return datetime.fromisoformat(s).astimezone(KST).replace(tzinfo=None)
        except Exception:
            return None

    def _first_future_session(self, meetup, now_naive):
        """다회차 시즌 → 가장 이른 '미래' 세션 날짜를 대표로. 없으면 openingDate."""
        dates = []
        for sess in (meetup.get('sessions') or []):
            dt = self._parse_iso(sess.get('date'))
            if dt:
                dates.append(dt)
        dates.sort()
        for dt in dates:
            if dt >= now_naive:
                return dt
        # 미래 세션이 없으면(진행 중) 첫 세션이라도, 그것도 없으면 openingDate
        if dates:
            return dates[0]
        return self._parse_iso(meetup.get('openingDate'))

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        now_naive = datetime.now(KST).replace(tzinfo=None)
        try:
            with httpx.Client(headers=HEADERS, timeout=20, follow_redirects=True) as client:
                for t in TYPES:
                    offset = 0
                    while offset < 1000:   # 안전 상한
                        r = client.get(DH_API, params={'type': t, 'upcoming': 'true', 'limit': 32, 'offset': offset})
                        if r.status_code != 200:
                            self.logger.warning(f'동행클럽 type={t} {r.status_code} (offset {offset})')
                            break
                        data = (r.json() or {}).get('data') or {}
                        meetups = data.get('meetups') or []
                        if not meetups:
                            break
                        for wrap in meetups:
                            try:
                                self._process(wrap.get('meetup') or {}, now_naive, events)
                            except Exception as e:
                                self.logger.warning(f'동행클럽 파싱 실패: {e}')
                        offset += 32
                        if offset >= (data.get('totalCount') or 0):
                            break
                        time.sleep(0.3)
        except Exception as e:
            self.logger.error(f'동행클럽 크롤링 실패: {e}')

        # 한 모임이 여러 type 에 중복 노출되므로 source_url 로 중복 제거.
        seen: set[str] = set()
        unique = [e for e in events if e.source_url not in seen and not seen.add(e.source_url)]
        filtered = [e for e in unique if is_within_one_month(e.event_date)]
        self.logger.info(f'동행클럽 총 {len(filtered)}개 (중복·날짜필터 전 {len(events)}개)')
        return filtered

    def _process(self, m, now_naive, events):
        mid = m.get('id')
        if not mid:
            return
        event_date = self._first_future_session(m, now_naive)
        if not event_date or event_date < now_naive:
            return

        title = sanitize_text(m.get('title', ''), 80)
        tags = m.get('tags') or {}
        region = (tags.get('region') or [None])[0] or m.get('briefLocation') or '서울'
        # 카테고리 — salonCategory 없으면 salonFilter, 그래도 없으면 '라이프스타일' 기본
        # (2026-08-21: 카테고리 없는 모임이 앱에서 배지 없이 떠 소셜링 필터에 안 잡히던 문제).
        salon = (tags.get('salonCategory') or [None])[0] \
            or (tags.get('salonFilter') or [None])[0] \
            or '라이프스타일'

        price = m.get('discountPrice') or m.get('price')
        price_val = int(price) if price is not None else None

        # 총원 정원/참가(성별 없음). 성비 필드는 대개 null → 있을 때만.
        max_cap = m.get('maxCapacity')
        attendee = m.get('attendeeCount')
        f_cap, f_cnt = m.get('femaleCapacity'), m.get('femaleCount')
        ma_cap, ma_cnt = m.get('maleCapacity'), m.get('maleCount')

        stats = {}
        if max_cap is not None:
            stats['total_capacity'] = int(max_cap)
        if attendee is not None:
            stats['total_count'] = int(attendee)
        gender_ratio = None
        if (ma_cnt is not None) or (f_cnt is not None):
            gender_ratio = f'{ma_cnt or 0}:{f_cnt or 0}'
            stats['male_count'] = ma_cnt or 0
            stats['female_count'] = f_cnt or 0

        # 마감: 신청마감일 지났거나 정원 다 참
        is_closed = False
        cd = self._parse_iso(m.get('closingDate'))
        if cd and cd < now_naive:
            is_closed = True
        if max_cap and attendee is not None and attendee >= max_cap:
            is_closed = True

        # 썸네일: thumbnailUrl → 첫 세션 place → contents 순
        thumb = m.get('thumbnailUrl')
        if not thumb:
            for sess in (m.get('sessions') or []):
                pl = (sess.get('place') or {}).get('thumbnailUrl')
                if pl:
                    thumb = pl
                    break
        if not thumb:
            for c in (m.get('contents') or []):
                if c.get('thumbnailUrl'):
                    thumb = c['thumbnailUrl']
                    break

        # 상세 설명 — 동행클럽은 소개글(description)이 없고 세션 커리큘럼이 본문이다.
        # 각 세션 [제목]\n본문 을 이어붙여 상세 설명으로 쓴다(앱 소셜링 상세에 표시).
        cur_parts = []
        for x in (m.get('curriculums') or []):
            t = (x.get('title') or '').strip()
            b = (x.get('body') or '').strip()
            if not (t or b):
                continue
            cur_parts.append(f'[{t}]\n{b}' if t and b else (t or b))
        description = format_donghaeng_desc('\n\n'.join(cur_parts)) if cur_parts else None

        # 나이는 제목 괄호 안에만 있다 — 예: "… (25-35세)", "… (27~37세 / 시즌 6)".
        # 전용 필드가 없어서 그동안 전부 비어 있었다(2026-09-10 전수 조사에서 발견,
        # 앞으로 일정 165건 중 15건이 제목에 나이를 달고 있었다).
        # ⚠️ 상세 페이지 아래쪽 «다른 모임 추천»에도 나이가 찍히므로 본문은 쓰지 않는다.
        age_min = age_max = None
        am = re.search(r'(\d{2})\s*[-~]\s*(\d{2})\s*세', m.get('title', '') or '')
        if am:
            a, b = int(am.group(1)), int(am.group(2))
            if a > b:
                a, b = b, a
            if 15 <= a <= 80 and 15 <= b <= 80:
                age_min, age_max = a, b

        events.append(EventModel(
            external_id=f'donghaeng_{mid}',
            title=title,
            description=description,
            age_range_min=age_min,
            age_range_max=age_max,
            thumbnail_urls=[thumb] if thumb else [],
            event_date=event_date,
            location_region=region,
            price_male=price_val,
            price_female=price_val,
            gender_ratio=gender_ratio,
            participant_stats=stats or None,
            source_url=f'{DH_WEB}/meetups/{mid}',
            is_closed=is_closed,
            event_type='socialing',
            socialing_category=salon,
        ))
