"""연숲(yeon_soop_) — 인스타그램만 쓰는 업체 스크래퍼.

## 왜 다른 업체와 방식이 다른가

연숲은 웹사이트가 없다. 일정 공지가 인스타 게시물 캡션에만 올라온다.
인스타의 로그인 없는 조회 API(web_profile_info)는 2026-09-01 기준 막혀 있어
(`400 Asset asset://laser.provider/... has been deleted`) 우리가 직접 못 받는다.
그래서 **Apify 유료 액터(apify/instagram-scraper)로 캡션을 받아 파싱한다.**
실측 비용은 게시물 50건 요청 1회에 $0.027 — 하루 2회 정기 크롤 기준 월 $1.6 수준이다.

## 이 업체의 캡션 생김새

    📌 [파티 일정 및 장소 안내]
    • 일시: 8월 21일(금) 19:30 ~ 24:00
    • 대상: 90년생 ~ 01년생 솔로남녀 50명 내외,
    • 장소: 사당역 5분 거리(신청 확정자 대상 상세 위치 안내)
    • 참가비: 72,000원 (와인/위스키 포함)
    • 신청기한 : 8.18(화) 24시까지

    ✓ 일시: 9/5(토) 오후 3시
    ✓ 장소: 선릉역 도보 5분 거리 프라이빗 공간
    ✓ 참가비: 얼리버드 특가 48,000원 (8/31까지, 이후 정가 53,000원)

'일시'와 '참가비'가 둘 다 있는 게시물만 모집 공고로 본다. 후기·마감안내·
참가자현황 같은 글은 이 조건에서 자연히 걸러진다(실측 10건 중 공고는 3건).

## source_url 을 인스타 게시물 주소로 쓰는 이유

같은 회차를 여러 번 올린다(8/21 파티는 8/10·8/16 두 번). 신청 링크는 회차마다
있기도 없기도 해서(9/5 회차는 "프로필 링크 클릭"이 전부) 중복 방지 키로 못 쓴다.
게시물 주소는 회차당 유일하고 영원히 안 바뀌므로, **같은 회차를 알린 게시물 중
가장 먼저 올라온 것**을 대표로 골라 그 주소를 쓴다. 나중에 재공지가 올라와도
대표가 안 바뀌어 중복 행이 안 생긴다.
"""
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from .base_scraper import BaseScraper, KST
from models.event import EventModel
from utils.security import tidy_socialing_desc

APIFY_ACTOR = 'shu8hvrXbJbY3Eb9W'  # apify/instagram-scraper
HANDLE = 'yeon_soop_'

# 업체 프로필 사진(R2 재호스팅, 1080px WebP 20KB). 연숲은 회차별 포스터 대신
# 안내 이미지를 올려서 회차마다 다른 썸네일을 뽑을 수가 없다. 그래서 피드 썸네일과
# 상세 히어로를 모두 이 한 장으로 고정한다(2026-09-01 오너 지시).
# 일정 전부가 같은 주소를 보므로 통신은 1회, 나머지는 캐시다.
PROFILE_IMAGE = 'https://sodate-admin.pages.dev/media/insta/yeon_soop_/profile-1080.webp'

# 항목 줄 = "불릿 + 라벨 + 콜론 + 값". 불릿은 업체가 매번 다르게 쓴다(• / ✓ / V / 📌).
#
# ⚠️ 라벨을 줄 안 아무 데서나 찾으면 안 된다. 이 업체 캡션에는
#    "• 풍성한 주류 & 장소: 와인/하이볼 세팅…" 이라는 **소개 문구**가 진짜
#    "• 장소: 사당역 5분 거리" 보다 위에 있어서, 그냥 search 하면 장소가
#    '와인/하이볼'로 잡힌다(2026-09-01 첫 파싱에서 실제로 그렇게 나왔다).
#    그래서 줄 첫머리 4글자 안에 라벨이 와야만 인정한다 — 불릿("• ", "✓ ", "V ")은
#    통과하고, 앞에 설명이 붙은 줄은 걸러진다.
def _label(pattern: str) -> re.Pattern:
    return re.compile(rf'^.{{0,4}}?{pattern}\s*[:：]\s*(.+)$', re.MULTILINE)


_LINE_DATE = _label(r'일\s*시')
_LINE_PLACE = _label(r'장\s*소')
_LINE_PRICE = _label(r'참\s*가\s*비')
_LINE_TARGET = _label(r'대\s*상')
_LINE_DEADLINE = _label(r'신\s*청\s*기\s*한')

_MD_KOR = re.compile(r'(\d{1,2})\s*월\s*(\d{1,2})\s*일')
_MD_SLASH = re.compile(r'(\d{1,2})\s*[/.]\s*(\d{1,2})')
_HHMM = re.compile(r'(\d{1,2})\s*:\s*(\d{2})')
_AMPM = re.compile(r'(오전|오후)\s*(\d{1,2})\s*시')
_WON = re.compile(r'([\d][\d,]*)\s*원')
_BIRTH_RANGE = re.compile(r'(\d{2})\s*년생\s*[~\-–]\s*(\d{2})\s*년생')
_STATION = re.compile(r'([가-힣A-Za-z0-9]{1,10}?)역')
_HASHTAG_LINE = re.compile(r'^\s*(?:#\S+\s*)+$', re.MULTILINE)

# 정가/할인 표기. "얼리버드 특가 48,000원 (8/31까지, 이후 정가 53,000원)"
_LIST_PRICE = re.compile(r'정\s*가\s*([\d][\d,]*)\s*원')
_EARLY_UNTIL = re.compile(r'(\d{1,2})\s*[/.]\s*(\d{1,2})\s*까지')

# 본문(해시태그 제외)에 이게 있으면 소셜링, 없고 소개팅 표현만 있으면 소개팅.
_SOCIALING = re.compile(r'소셜링|소셜\s*파티|소셜파티')
_DATING = re.compile(r'로테이션\s*소개팅|소개팅')


def _won(text: str) -> Optional[int]:
    m = _WON.search(text)
    return int(m.group(1).replace(',', '')) if m else None


def _strip_hashtags(caption: str) -> str:
    """해시태그만 있는 줄을 걷어낸다 — 업종 판정에서 본문 표현이 이겨야 한다.

    8/21 소셜링 파티 글은 본문이 '소셜 파티 오픈'인데 해시태그에
    #로테이션소개팅 이 붙어 있다. 해시태그까지 같이 보면 소개팅으로 잘못 분류된다.
    """
    return _HASHTAG_LINE.sub('', caption)


class YeonsoopScraper(BaseScraper):
    # 업체가 자기 공지에 직접 적은 금액이라 정본으로 본다.
    WRITES_PRICE = True
    # 대상 년생("90년생 ~ 01년생")도 업체 공지가 정본 → None 도 기록해 옛 값을 지운다.
    WRITES_AGE = False
    # 정원을 남녀로 나눠 적지 않는다("50명 내외") → 좌석·정원은 건드리지 않는다.
    WRITES_SEATS = False
    # 인스타 최근 게시물만 보는 구조라 "전체 일정을 다 봤다"고 말할 수 없다.
    # 지난 일정 정리는 base_scraper 가 날짜 기준으로 알아서 한다.
    DELETE_STALE = False

    RESULTS_LIMIT = 50

    def __init__(self):
        super().__init__('yeonsoop')

    # ------------------------------------------------------------------ 수집

    def _fetch_posts(self) -> list[dict]:
        """Apify 액터를 동기 실행해 게시물 목록을 받는다."""
        token = os.environ.get('APIFY_TOKEN')
        if not token:
            raise RuntimeError('APIFY_TOKEN 미설정 — 인스타 캡션을 받을 수 없다')
        r = httpx.post(
            f'https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items',
            params={'token': token},
            json={
                'directUrls': [f'https://www.instagram.com/{HANDLE}/'],
                'resultsType': 'posts',
                'resultsLimit': self.RESULTS_LIMIT,
                'searchType': 'hashtag',
                'addParentData': False,
            },
            timeout=300,
        )
        r.raise_for_status()
        items = r.json()
        if not isinstance(items, list):
            raise RuntimeError(f'Apify 응답 형식이 예상과 다름: {str(items)[:200]}')
        return items

    # ------------------------------------------------------------------ 파싱

    @staticmethod
    def _parse_datetime(line: str, posted: datetime) -> Optional[datetime]:
        """'일시' 줄에서 KST 날짜·시각을 뽑는다. 연도는 게시일 기준으로 정한다."""
        m = _MD_KOR.search(line) or _MD_SLASH.search(line)
        if not m:
            return None
        month, day = int(m.group(1)), int(m.group(2))
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return None

        hour, minute = None, None
        if (t := _HHMM.search(line)):
            hour, minute = int(t.group(1)), int(t.group(2))
        elif (t := _AMPM.search(line)):
            hour, minute = int(t.group(2)), 0
            if t.group(1) == '오후' and hour < 12:
                hour += 12
            elif t.group(1) == '오전' and hour == 12:
                hour = 0
        if hour is None or not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None

        # 연도 추론: 게시일과 같은 해를 먼저 보고, 그게 게시일보다 30일 넘게
        # 과거면 다음 해 일정으로 본다(12월에 올린 1월 일정 대비).
        for year in (posted.year, posted.year + 1):
            try:
                dt = datetime(year, month, day, hour, minute)
            except ValueError:
                return None
            if dt >= posted - timedelta(days=30):
                return dt
        return None

    @staticmethod
    def _parse_price(line: str, now: datetime) -> Optional[int]:
        """'참가비' 줄에서 **지금 시점에 실제로 내는 금액**을 뽑는다.

        얼리버드가 적혀 있으면 그 기한이 안 지났을 때만 할인가를, 지났으면 정가를
        쓴다. 기한을 못 읽으면 정가 쪽으로 간다(싸게 표시했다가 비싸게 받는 것보다,
        비싸게 표시했다가 싸게 받는 쪽이 사용자에게 덜 나쁘다).
        """
        listed = _LIST_PRICE.search(line)
        first = _won(line)
        if not listed:
            return first
        list_price = int(listed.group(1).replace(',', ''))
        until = _EARLY_UNTIL.search(line)
        if not until:
            return list_price
        month, day = int(until.group(1)), int(until.group(2))
        for year in (now.year, now.year + 1):
            try:
                deadline = datetime(year, month, day, 23, 59)
            except ValueError:
                return list_price
            if deadline >= now - timedelta(days=30):
                return first if now <= deadline else list_price
        return list_price

    @staticmethod
    def _parse_region(line: str) -> tuple[str, str]:
        """'장소' 줄 → (지역, 상세). '사당역 5분 거리(...)' → ('사당', '사당역 5분 거리')."""
        detail = line.split('(')[0].strip().rstrip(',').strip()
        m = _STATION.search(detail)
        region = m.group(1) if m else (detail.split()[0] if detail.split() else '기타')
        return region, (detail or region)

    @staticmethod
    def _parse_ages(line: str, event_year: int) -> tuple[Optional[int], Optional[int]]:
        """'대상' 줄의 '90년생 ~ 01년생' → (최소나이, 최대나이). 연 나이 기준."""
        m = _BIRTH_RANGE.search(line)
        if not m:
            return None, None
        years = []
        for two in (m.group(1), m.group(2)):
            n = int(two)
            years.append(1900 + n if n >= 50 else 2000 + n)
        old, young = min(years), max(years)
        return event_year - young, event_year - old

    def _parse_post(self, post: dict, now: datetime) -> Optional[dict]:
        """게시물 하나 → 일정 정보. 모집 공고가 아니면 None."""
        caption = (post.get('caption') or '').strip()
        if not caption:
            return None
        body = _strip_hashtags(caption)

        date_line = _LINE_DATE.search(body)
        price_line = _LINE_PRICE.search(body)
        # 일시와 참가비가 둘 다 있어야 모집 공고다. 후기·마감안내는 여기서 걸린다.
        if not date_line or not price_line:
            return None

        posted = datetime.fromisoformat(post['timestamp'].replace('Z', '+00:00'))
        posted_kst = posted.astimezone(KST).replace(tzinfo=None)

        event_date = self._parse_datetime(date_line.group(1), posted_kst)
        if not event_date:
            self.logger.warning(f"일시를 못 읽음: {date_line.group(1)[:60]!r} ({post.get('url')})")
            return None

        price = self._parse_price(price_line.group(1), now)

        place_line = _LINE_PLACE.search(body)
        region, detail = self._parse_region(place_line.group(1)) if place_line else ('기타', '')

        target_line = _LINE_TARGET.search(body)
        age_min, age_max = (
            self._parse_ages(target_line.group(1), event_date.year) if target_line else (None, None)
        )

        # 신청기한이 지났으면 마감. 연도는 일정 연도를 따른다(신청기한 < 일정).
        is_closed = False
        if (dl := _LINE_DEADLINE.search(body)) and (m := _MD_SLASH.search(dl.group(1)) or _MD_KOR.search(dl.group(1))):
            try:
                closed_at = datetime(event_date.year, int(m.group(1)), int(m.group(2)), 23, 59)
                is_closed = now > closed_at
            except ValueError:
                pass

        event_type = 'socialing' if _SOCIALING.search(body) else ('dating' if _DATING.search(body) else None)
        if event_type is None:
            self.logger.warning(f"소개팅/소셜링 판정 불가 — 건너뜀: {post.get('url')}")
            return None

        kind = '로테이션 소개팅' if event_type == 'dating' else '소셜링 파티'
        return {
            'external_id': post.get('shortCode'),
            'title': f'{region} {kind}',
            'description': tidy_socialing_desc(caption),
            'event_date': event_date,
            'location_region': region,
            'location_detail': detail or None,
            'price_male': price,
            'price_female': price,
            'age_range_min': age_min,
            'age_range_max': age_max,
            'event_type': event_type,
            'is_closed': is_closed,
            'source_url': post.get('url') or f"https://www.instagram.com/p/{post.get('shortCode')}/",
            'posted_at': posted_kst,
        }

    # ------------------------------------------------------------------ 실행

    def scrape(self) -> list[EventModel]:
        posts = self._fetch_posts()
        self.logger.info(f'인스타 게시물 {len(posts)}건 수신')
        # 얼리버드·신청기한 판정 기준시각. 캡션의 날짜가 전부 KST 표기라 KST 로 맞춘다
        # (GitHub Actions 러너는 UTC 라 datetime.now() 를 그냥 쓰면 9시간 어긋난다).
        now = datetime.now(timezone.utc).astimezone(KST).replace(tzinfo=None)

        parsed = [p for p in (self._parse_post(post, now) for post in posts) if p]

        # 같은 회차를 여러 번 올린다 → (종류, 일시, 지역)이 같으면 한 회차로 본다.
        # 대표는 **가장 먼저 올린 게시물** — 재공지가 붙어도 source_url 이 안 바뀐다.
        by_key: dict[tuple, dict] = {}
        for p in parsed:
            key = (p['event_type'], p['event_date'], p['location_region'])
            if key not in by_key or p['posted_at'] < by_key[key]['posted_at']:
                by_key[key] = p
        if len(parsed) != len(by_key):
            self.logger.info(f'중복 공지 {len(parsed) - len(by_key)}건 합침 → 회차 {len(by_key)}건')

        events = []
        for p in by_key.values():
            p.pop('posted_at')
            events.append(EventModel(thumbnail_urls=[PROFILE_IMAGE], **p))

        self.logger.info(f'모집 공고 {len(events)}건 파싱')
        return events
