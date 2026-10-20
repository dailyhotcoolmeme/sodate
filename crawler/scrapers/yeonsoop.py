"""연숲(yeon_soop_) — 인스타 캡션 + 무료 로컬 포스터 OCR 스크래퍼.

## 왜 다른 업체와 방식이 다른가

연숲은 웹사이트가 없다. 최근 일정 공지는 캡션 없이 이미지에만 올라온다.
인스타의 로그인 없는 조회 API(web_profile_info)는 2026-09-01 기준 막혀 있어
(`400 Asset asset://laser.provider/... has been deleted`) 우리가 직접 못 받는다.
그래서 **기존 Apify 정기 수집으로 게시물/이미지 주소를 받고**, 캡션에 일정이
없으면 Tesseract 한국어 OCR 두 방식으로 같은 이미지의 명시된 날짜·시간·역을
대조한다. OCR은 로컬 실행이므로 AI 토큰/외부 OCR API 비용이 없다.
복구 검증은 --reuse-last-run으로 18시간 이내 기존 결과만 읽어 추가 액터 실행을 막는다.
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

'캡션 파서'는 '일시'와 '참가비'가 둘 다 있어야 모집 공고로 본다. 후기·마감안내·
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
from bs4 import BeautifulSoup

from .base_scraper import BaseScraper, KST
from models.event import EventModel
from utils.security import tidy_socialing_desc
from utils.date_filter import is_within_one_month
from utils.poster_ocr import PosterOCR

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
_AMPM = re.compile(r'(오전|오후)\s*(\d{1,2})(?:\s*:\s*(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)?')
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
    PRESERVE_MISSING_PRICES = True
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
        if os.environ.get('YEONSOOP_REUSE_LAST_RUN') == '1':
            # 복구 검증용: 이미 완료된 결과만 GET. 유료 액터를 새로 실행하지 않는다.
            headers = {'Authorization': f'Bearer {token}'}
            meta = httpx.get(f'https://api.apify.com/v2/actors/{APIFY_ACTOR}/runs/last',
                             params={'status': 'SUCCEEDED'}, headers=headers, timeout=30)
            if meta.status_code != 200:
                raise RuntimeError(f'기존 인스타 실행 조회 실패 HTTP {meta.status_code}')
            run = meta.json()['data']
            finished = datetime.fromisoformat(run['finishedAt'].replace('Z', '+00:00'))
            age = datetime.now(timezone.utc) - finished
            if age < timedelta(0) or age > timedelta(hours=18):
                raise RuntimeError('기존 인스타 수집 결과가 18시간보다 오래됨 — 재사용 중단')
            res = httpx.get(f"https://api.apify.com/v2/datasets/{run['defaultDatasetId']}/items",
                            params={'clean': 'true'}, headers=headers, timeout=30)
            if res.status_code != 200 or not isinstance(res.json(), list):
                raise RuntimeError(f'기존 인스타 자료 조회 실패 HTTP {res.status_code}')
            return res.json()
        r = httpx.post(
            f'https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items',
            # 토큰을 URL 쿼리에 넣으면 httpx 예외 문자열과 crawl_logs.error_message에
            # 그대로 남는다. Apify가 권장하는 Bearer 헤더를 써서 로그 유출을 막는다.
            headers={'Authorization': f'Bearer {token}'},
            json={
                'directUrls': [f'https://www.instagram.com/{HANDLE}/'],
                'resultsType': 'posts',
                'resultsLimit': self.RESULTS_LIMIT,
                'searchType': 'hashtag',
                'addParentData': False,
            },
            timeout=300,
        )
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status == 402:
                raise RuntimeError(
                    'Apify HTTP 402 Payment Required — 사용량/결제 한도 확인 필요'
                ) from None
            raise RuntimeError(f'Apify HTTP {status} — 게시물 조회 실패') from None
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
        # "오후 2:30시"를 일반 HH:MM으로 먼저 읽으면 02:30이 된다.
        # 오전/오후 표기가 있으면 그쪽을 우선해 24시간제로 바꾼다.
        if (t := _AMPM.search(line)):
            hour, minute = int(t.group(2)), int(t.group(3) or t.group(4) or 0)
            if not 1 <= hour <= 12:
                return None
            if t.group(1) == '오후' and hour < 12:
                hour += 12
            elif t.group(1) == '오전' and hour == 12:
                hour = 0
        elif (t := _HHMM.search(line)):
            hour, minute = int(t.group(1)), int(t.group(2))
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

    def _parse_poster_text(self, text: str, post: dict) -> Optional[dict]:
        """한 이미지 안의 명시된 일시·역·모임 종류만 결합한다. 다른 이미지 값은 섞지 않는다."""
        posted = datetime.fromisoformat(post['timestamp'].replace('Z', '+00:00')).astimezone(KST).replace(tzinfo=None)
        dates = set()
        for line in text.splitlines():
            if not (_MD_KOR.search(line) or _MD_SLASH.search(line)):
                continue
            # 1:30만 있으면 오전/오후 추측 금지. 13~23시 표기는 명백한 24시간제다.
            clock = _HHMM.search(line)
            if not _AMPM.search(line) and not (clock and 13 <= int(clock.group(1)) <= 23):
                continue
            if (date := self._parse_datetime(line, posted)):
                dates.add(date)
        stations = set(_STATION.findall(text))
        compact = re.sub(r'\s+', '', text)
        if len(dates) != 1 or len(stations) != 1 or not _DATING.search(compact):
            return None
        date = next(iter(dates))
        if not is_within_one_month(date):
            return None
        station = next(iter(stations)) + '역'
        prices = []
        for line in text.splitlines():
            if re.match(r'^\s*참가비\s*[:：]?', line):
                amounts = set(_WON.findall(line))
                if len(amounts) == 1:
                    prices.append(int(next(iter(amounts)).replace(',', '')))
        price = prices[0] if len(set(prices)) == 1 and 10000 <= prices[0] <= 300000 else None
        return dict(
            external_id=post.get('shortCode'), title=f'{station} 로테이션 소개팅',
            event_date=date, location_region=station, location_detail=station,
            price_male=price, price_female=price, event_type='dating',
            source_url=post.get('url') or f"https://www.instagram.com/p/{post['shortCode']}/",
            posted_at=posted,
            _poster=True,
        )

    def _parse_posters(self, post: dict, reader: PosterOCR) -> list[dict]:
        out = []
        urls = post.get('images') or ([post['displayUrl']] if post.get('displayUrl') else [])
        for url in dict.fromkeys(urls[:8]):
            try:
                a, b = (self._parse_poster_text(t, post) for t in reader.read(url))
                # 서로 다른 레이아웃 인식 두 번의 날짜·장소가 일치해야 저장 후보다.
                if not a or not b or (a['event_date'], a['location_region']) != (b['event_date'], b['location_region']):
                    continue
                if a['price_male'] != b['price_male']:
                    a['price_male'] = a['price_female'] = None
                out.append(a)
            except Exception as exc:
                # 서명 URL/토큰/참석자 내용은 오류 로그에 출력하지 않는다.
                self.logger.warning(f"포스터 인식 스킵 {post.get('shortCode')}: {type(exc).__name__}")
        return out

    def _reconfirm_owner_events(self) -> list[EventModel]:
        """공개 프로필과 기존 오너 확인 일시를 대조만 한다. 새 일정/시각을 추정하지 않는다."""
        try:
            rows = self._select_all('*', company_id=self.get_company_id(),
                                    verified=True, is_active=True)
            now = datetime.now(KST)
            rows = [r for r in rows if datetime.fromisoformat(
                r['event_date'].replace('Z', '+00:00')) >= now]
            if not rows:
                return []
            response = httpx.get(f'https://www.instagram.com/{HANDLE}/', timeout=25,
                                 follow_redirects=False)
            response.raise_for_status()
            meta = BeautifulSoup(response.text, 'html.parser').find('meta', attrs={'name': 'description'})
            text = meta.get('content', '') if meta else ''
            marker = f'(@{HANDLE}) on Instagram: "'
            if marker not in text:
                return []
            bio = text.split(marker, 1)[1].rsplit('"', 1)[0]
            events = []
            for row in rows:
                date = datetime.fromisoformat(row['event_date'].replace('Z', '+00:00')).astimezone(KST)
                if not is_within_one_month(date.replace(tzinfo=None)):
                    continue
                matching = []
                for line in bio.splitlines():
                    dates = list(_MD_SLASH.finditer(line))
                    clocks = list(_HHMM.finditer(line))
                    stations = _STATION.findall(line)
                    if len(dates) != 1 or len(clocks) != 1 or len(stations) != 1:
                        continue
                    md, clock = dates[0], clocks[0]
                    if (int(md[1]), int(md[2])) != (date.month, date.day):
                        continue
                    if stations[0] != row['location_region'].removesuffix('역'):
                        continue
                    hour, minute = int(clock[1]), int(clock[2])
                    # 명시된 오전/오후 또는 24시간제는 그대로 비교한다.
                    # 모호한 1:30의 오후 여부는 이미 verified인 해당 행에서만 가져온다.
                    if _AMPM.search(line):
                        parsed = self._parse_datetime(line, date.replace(tzinfo=None))
                        same_clock = parsed is not None and (parsed.hour, parsed.minute) == (date.hour, date.minute)
                    elif re.search(r'(?<![A-Za-z])(?:am|pm)\b', line, re.I):
                        suffix = re.search(r'(?<![A-Za-z])(am|pm)\b', line, re.I)[1].lower()
                        same_clock = 1 <= hour <= 12 and (hour % 12 + (12 if suffix == 'pm' else 0), minute) == (date.hour, date.minute)
                    else:
                        same_clock = minute == date.minute and (hour == date.hour or (1 <= hour <= 12 and hour == (date.hour % 12 or 12)))
                    if same_clock:
                        matching.append(line)
                if len(matching) == 1:
                    # 동일 회차가 여러 행이면 임의로 고르지 않는다.
                    peers = [r for r in rows if r['event_date'] == row['event_date']
                             and r.get('location_region') == row.get('location_region')]
                    if len(peers) == 1:
                        events.append(EventModel(**{**row, 'event_date': date.replace(tzinfo=None)}))
            self.logger.info(f'공식 프로필에서 오너 확인 일정 {len(events)}건 재확인 (검증 행 수정 없음)')
            return events
        except Exception as exc:
            self.logger.warning(f'공식 프로필 대조 실패: {type(exc).__name__}')
            return []

    def scrape(self) -> list[EventModel]:
        posts = self._fetch_posts()
        self.logger.info(f'인스타 게시물 {len(posts)}건 수신')
        # 얼리버드·신청기한 판정 기준시각. 캡션의 날짜가 전부 KST 표기라 KST 로 맞춘다
        # (GitHub Actions 러너는 UTC 라 datetime.now() 를 그냥 쓰면 9시간 어긋난다).
        now = datetime.now(timezone.utc).astimezone(KST).replace(tzinfo=None)

        parsed = []
        reader = PosterOCR()
        invalid_posts = 0
        for post in posts:
            # Apify는 HTTP 200에도 error=no_items 같은 상태 항목을 반환한다.
            # 이를 게시물로 읽어 timestamp KeyError로 중단하지 않는다.
            try:
                datetime.fromisoformat(post['timestamp'].replace('Z', '+00:00'))
            except (KeyError, TypeError, ValueError, AttributeError):
                invalid_posts += 1
                continue
            if post.get('ownerUsername') not in (None, HANDLE):
                continue
            caption = self._parse_post(post, now)
            if caption and is_within_one_month(caption['event_date']):
                parsed.append(caption)
                continue
            # 최근 공지만 이미지 판독한다. 과거 후기까지 불필요하게 OCR하지 않는다.
            posted = datetime.fromisoformat(post['timestamp'].replace('Z', '+00:00')).astimezone(KST).replace(tzinfo=None)
            if now - timedelta(days=45) <= posted <= now:
                parsed.extend(self._parse_posters(post, reader))

        # 같은 회차를 여러 번 올린다 → (종류, 일시, 지역)이 같으면 한 회차로 본다.
        # 대표는 **가장 먼저 올린 게시물** — 재공지가 붙어도 source_url 이 안 바뀐다.
        by_key: dict[tuple, dict] = {}
        for p in parsed:
            key = (p['event_type'], p['event_date'], p['location_region'].removesuffix('역'))
            if (key not in by_key or p['posted_at'] < by_key[key]['posted_at']
                or (p['source_url'] == by_key[key]['source_url']
                    and by_key[key].get('price_male') is None and p.get('price_male') is not None)):
                by_key[key] = p
        if len(parsed) != len(by_key):
            self.logger.info(f'중복 공지 {len(parsed) - len(by_key)}건 합침 → 회차 {len(by_key)}건')

        # 포스터에 없는 마감·나이·설명은 기존 값을 보존한다. 같은 회차의 재공지
        # URL이 달라도 기존 대표 주소를 유지해 중복 일정이 생기지 않도록 한다.
        image_rows = []
        if any(p.get('_poster') for p in by_key.values()):
            image_rows = self._select_all('*', company_id=self.get_company_id())
        events = []
        for p in by_key.values():
            p.pop('posted_at')
            if p.pop('_poster', False):
                matches = [row for row in image_rows
                           if row['source_url'] == p['source_url'] or (
                               datetime.fromisoformat(row['event_date'].replace('Z', '+00:00')).astimezone(KST).replace(tzinfo=None) == p['event_date']
                               and row.get('event_type', 'dating') == p['event_type']
                               and (row.get('location_region') or '').removesuffix('역') == p['location_region'].removesuffix('역'))]
                if len(matches) > 1:
                    self.logger.warning('동일 회차의 기존 행이 여러 개 — 임의 매칭하지 않고 보존')
                    continue
                if matches:
                    old = matches[0]
                    p['source_url'] = old['source_url']
                    for field in ('title', 'description', 'location_detail', 'age_range_min',
                                  'age_range_max', 'age_male', 'age_female', 'is_closed'):
                        if field in old:
                            p[field] = old[field]
            events.append(EventModel(thumbnail_urls=[PROFILE_IMAGE], **p))

        if not events:
            events = self._reconfirm_owner_events()
        if invalid_posts:
            self.logger.warning(f'게시물이 아닌 인스타 응답 {invalid_posts}건 제외')
            if not events:
                raise RuntimeError('인스타 수집 서비스가 정상 게시물을 반환하지 않음 — 공식 프로필 대조도 불가')
        self.logger.info(f'모집 공고 {len(events)}건 파싱')
        return events


if __name__ == '__main__':
    import sys
    # 수동 검증은 기존 자료 재사용만 허용한다. 잘못된 인자가 유료 실행으로
    # 떨어지는 것을 막고, 정기 main.py 경로의 하루 2회 호출은 그대로 유지한다.
    if sys.argv[1:] != ['--reuse-last-run']:
        raise SystemExit('사용법: python -m scrapers.yeonsoop --reuse-last-run')
    os.environ['YEONSOOP_REUSE_LAST_RUN'] = '1'
    result = YeonsoopScraper().run()
    raise SystemExit(0 if result['status'] == 'success' else 1)
