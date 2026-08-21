"""트레바리 (trevari.co.kr) 스크래퍼 — 소셜링(놀러가기, 드롭인 1회 모임)

무인증 공개 REST JSON API:
  GET product-public-api.trevari.co.kr/api/v1/categories/outgoing/products
      ?eligible=false&page_no=N&page_size=100
(eligible=true 는 로그인 필요라 400 — 반드시 false)

event_type='socialing'. 트레바리는 독서모임 기반이라 socialing_category='독서·성장' 으로 통일.
성비·정확한 정원 숫자는 API에 없음(대기 배지로 마감/대기만 표현) → 좌석/나이 안 씀.
"""
import re
import time
from datetime import datetime, timezone, timedelta

import httpx

from .base_scraper import BaseScraper
from models.event import EventModel
from utils.security import sanitize_text
from utils.date_filter import is_within_one_month

KST = timezone(timedelta(hours=9))

TREVARI_WEB = 'https://trevari.co.kr'
TREVARI_API = 'https://product-public-api.trevari.co.kr/api/v1/categories/outgoing/products'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://trevari.co.kr/',
}
# "8/23(일) 10:00" 형태(연도 없음)
DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})\s*\([월화수목금토일]\)\s*(\d{1,2}):(\d{2})')


class TrevariScraper(BaseScraper):
    WRITES_PRICE = True
    WRITES_SEATS = False   # 성비·정원 숫자 없음
    WRITES_AGE = False
    DELETE_STALE = True

    def __init__(self):
        super().__init__('trevari')

    @staticmethod
    def _parse_date(badge: str, now_naive: datetime):
        """'8/23(일) 10:00' → naive KST datetime. 연도 없음 → 현재연도, 이미 하루 넘게
        지났으면 내년 것으로 본다(트레바리는 미래 이벤트만 노출)."""
        m = DATE_RE.search(badge or '')
        if not m:
            return None
        mo, d, hh, mm = int(m[1]), int(m[2]), int(m[3]), int(m[4])
        try:
            dt = datetime(now_naive.year, mo, d, hh, mm)
        except ValueError:
            return None
        if dt < now_naive - timedelta(days=1):
            try:
                dt = dt.replace(year=now_naive.year + 1)
            except ValueError:
                return None
        return dt

    def scrape(self) -> list[EventModel]:
        events: list[EventModel] = []
        now_naive = datetime.now(KST).replace(tzinfo=None)
        try:
            with httpx.Client(headers=HEADERS, timeout=20, follow_redirects=True) as client:
                page = 1
                while page <= 30:   # 안전 상한(현재 ~16페이지)
                    r = client.get(TREVARI_API, params={'eligible': 'false', 'page_no': page, 'page_size': 100})
                    if r.status_code != 200:
                        self.logger.warning(f'트레바리 목록 {r.status_code} (page {page})')
                        break
                    body = r.json()
                    for p in body.get('data', []) or []:
                        try:
                            pid = str(p.get('id'))
                            disp = p.get('display', {}) or {}
                            badges = disp.get('thumbnailBadges', {}) or {}

                            event_date = self._parse_date(badges.get('bottomLeft'), now_naive)
                            if not event_date or event_date < now_naive:
                                continue

                            region = badges.get('topLeft') or '서울'
                            title = sanitize_text(disp.get('title') or p.get('name', ''), 80)

                            price = (p.get('price') or {}).get('total')
                            price_val = int(price) if price is not None else None

                            thumb = disp.get('thumbnailUrl')
                            # 링크의 order= 는 '대기순번'이라 매 크롤마다 바뀐다 → source_url 에서 제거.
                            # 상품 id(pid)를 fragment 로 붙여 유니크성 확보(브라우저는 무시, 페이지는 열림).
                            link = disp.get('link') or '/meetings'
                            clean = re.sub(r'[?&]order=\d+', '', link)
                            source_url = f'{TREVARI_WEB}{clean}#p{pid}'

                            # 마감 판단 — '대기'는 아직 신청 가능(대기 등록)이라 마감 아님.
                            badge_texts = ' '.join((b.get('text') or '') for b in (disp.get('badges') or []))
                            is_closed = '마감' in badge_texts and '대기' not in badge_texts

                            events.append(EventModel(
                                external_id=f'trevari_{pid}',
                                title=title,
                                thumbnail_urls=[thumb] if thumb else [],
                                event_date=event_date,
                                location_region=region,
                                price_male=price_val,
                                price_female=price_val,
                                source_url=source_url,
                                is_closed=is_closed,
                                event_type='socialing',
                                socialing_category='독서·성장',
                            ))
                        except Exception as e:
                            self.logger.warning(f'트레바리 파싱 실패 id={p.get("id")}: {e}')

                    if not (body.get('paging') or {}).get('hasNext'):
                        break
                    page += 1
                    time.sleep(0.3)
        except Exception as e:
            self.logger.error(f'트레바리 크롤링 실패: {e}')

        filtered = [e for e in events if is_within_one_month(e.event_date)]
        self.logger.info(f'트레바리 총 {len(filtered)}개 (필터 전 {len(events)}개)')
        return filtered
