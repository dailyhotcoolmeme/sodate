"""파이낸스라운지(finance.lounge2030) 스크래퍼 — 자체 사이트 없이 인스타로만 운영,
일정+참석자 명단(이미지)은 노션 페이지에 공지된다. 노션(app.notion.com)은 Playwright
번들 Chromium을 "호환되지 않는 브라우저"로 판별해 앱 셸만 반환하므로, 반드시 로컬에
설치된 실제 Chrome(channel='chrome')으로 띄워야 정상 렌더링된다(2026-08-11 확인).

일정 텍스트와 참석자 명단 이미지는 노션 블록에서 서로 바로 이웃한 순서로 배치되어
있어(텍스트 블록 다음이 이미지 블록), data-block-id 순서로 훑어 페어링한다.
아직 이미지가 없는 회차("업데이트 예정")는 스킵하지 않고 이미지 없이만 저장한다.

신청은 인스타 DM으로만 이뤄지고 회차별 개별 URL이 없어, source_url은 인스타 프로필
URL에 회차를 구분하는 fragment(#e=...)를 붙여 유일성을 확보한다(secretsalon.py의
#evt= 관례와 동일)."""
import hashlib
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
from utils.r2_client import upload_bytes

NOTION_URL = 'https://app.notion.com/p/36116a6b5cf6802fbdf7f5671bf6dd93'
INSTAGRAM_URL = 'https://www.instagram.com/finance.lounge2030/'
# 노션 일정 텍스트에 사진이 없어(참석자 명단 이미지는 attendee_image_url로 별도 저장)
# 피드 썸네일·상세 상단 이미지가 비어 있었다. 업체 로고를 기본 썸네일로 고정한다
# (오너 지시 2026-08-13).
# ⚠️ v2: 상세페이지 히어로는 4:3 고정 틀(cover 크롭)이라, 원본 포스터(928x1226, 세로로
# 긴 3:4 비율)를 그대로 올리면 중앙 기준으로 위아래가 크게 잘려 제목("Finance Lounge/
# 금융권")이 통째로 잘려나갔다(오너 스크린샷으로 확인). 앱이 추가로 자르지 않도록
# 업로드 전에 정확히 4:3(928x696)으로 미리 잘라 제목이 항상 보이게 했다.
DEFAULT_THUMBNAIL = 'https://sodate-admin.pages.dev/media/thumbnails/finance-lounge/logo-thumb-v2.webp'

# "8.12 20시 용산 (20대+심층대화 특집, ...)" / "8.14 20시 삼성(마감)" / "8.20 20시반 용산"
_SCHEDULE_RE = re.compile(
    r'^(\d{1,2})\.(\d{1,2})\s+(\d{1,2})시(반)?\s*([가-힣]*)\s*(?:\(([^)]*)\))?\s*$'
)
# "96-00" 같은 출생연도 범위 힌트(짧은 두자리 연도)
_BIRTH_RANGE_RE = re.compile(r'\b(\d{2})-(\d{2})\b')
# "남95-00 / 여97-02"처럼 성별마다 출생연도가 다른 경우 — 위 \b는 "남"(한글도 \w 취급)
# 바로 뒤 숫자엔 경계가 안 생겨 못 잡는다. 성별 글자를 앵커로 직접 잡는다.
_GENDER_BIRTH_RE = re.compile(r'(남|여)\s*(\d{2})[-~](\d{2})')


def _year_for(yy: int) -> int:
    return 2000 + yy if yy <= 30 else 1900 + yy


class FinanceLoungeScraper(BaseScraper):
    def __init__(self):
        super().__init__('finance-lounge')

    def scrape(self) -> list[EventModel]:
        blocks = self._fetch_blocks()
        if not blocks:
            self.logger.warning('파이낸스라운지 노션 블록을 하나도 못 가져옴')
            return []

        events: list[EventModel] = []
        now = datetime.now()

        for i, block in enumerate(blocks):
            text = block['text']
            m = _SCHEDULE_RE.match(text)
            if not m:
                continue

            month, day, hour = int(m.group(1)), int(m.group(2)), int(m.group(3))
            minute = 30 if m.group(4) else 0
            region_raw = (m.group(5) or '').strip()
            note = (m.group(6) or '').strip()
            if not region_raw:
                # 지역 미공지 회차("8.22 11시" 처럼 아직 업데이트 전) — 지역은 DB 필수값이라 스킵
                self.logger.debug(f'지역 미공지로 스킵: {text!r}')
                continue
            if not (1 <= month <= 12 and 1 <= day <= 31):
                continue

            try:
                event_date = datetime(now.year, month, day, hour, minute)
            except ValueError:
                continue
            if event_date < now.replace(hour=0, minute=0, second=0, microsecond=0):
                event_date = datetime(now.year + 1, month, day, hour, minute)

            region = resolve_region(region_phrase=region_raw)
            is_closed = '마감' in note

            age_group_label = None
            age_range_min = age_range_max = None
            age_male = age_female = None
            if '20대' in note:
                age_group_label, age_range_min, age_range_max = '20대', 20, 29
            elif '30대' in note:
                age_group_label, age_range_min, age_range_max = '30대', 30, 39

            gender_matches = _GENDER_BIRTH_RE.findall(note)
            if gender_matches:
                # "남95-00 / 여97-02"처럼 성별마다 출생연도가 다른 경우 — 각각 age_male/age_female에,
                # 전체 필터용 age_range_min/max는 두 성별을 합친 범위로.
                mins, maxs = [], []
                for gender, y1s, y2s in gender_matches:
                    y1, y2 = _year_for(int(y1s)), _year_for(int(y2s))
                    lo, hi = min(y1, y2), max(y1, y2)
                    a_min, a_max = now.year - hi, now.year - lo
                    mins.append(a_min)
                    maxs.append(a_max)
                    disp = f'{a_min}~{a_max}'
                    if gender == '남':
                        age_male = disp
                    else:
                        age_female = disp
                age_range_min, age_range_max = min(mins), max(maxs)
                age_group_label = f'{age_range_min}~{age_range_max}세'
            else:
                bm = _BIRTH_RANGE_RE.search(note)
                if bm:
                    y1, y2 = _year_for(int(bm.group(1))), _year_for(int(bm.group(2)))
                    lo, hi = min(y1, y2), max(y1, y2)
                    age_range_max = now.year - lo
                    age_range_min = now.year - hi
                    age_group_label = f'{age_range_min}~{age_range_max}세'
                    # 성별 구분 없는 단일 범위는 앱 상세페이지의 남성/여성 정보 행이 뜨도록
                    # age_male/age_female에도 동일하게 채운다(안 채우면 그 행 자체가 숨겨짐).
                    age_male = age_female = f'{age_range_min}~{age_range_max}'

            # "20대"/"30대" 태그만 있고 출생연도 범위는 없는 경우도 남성/여성 정보 행이 뜨도록.
            if age_male is None and age_range_min is not None:
                age_male = age_female = f'{age_range_min}~{age_range_max}'

            # 바로 다음 블록이 이미지면 페어링(참석자 명단). 텍스트 블록("업데이트 예정")이면 아직 없음.
            attendee_image_url = None
            if i + 1 < len(blocks) and blocks[i + 1]['has_img'] and blocks[i + 1]['img_src']:
                attendee_image_url = self._rehost_image(
                    blocks[i + 1]['img_src'], month, day, hour, minute, region_raw
                )

            frag = f'e={month:02d}{day:02d}_{hour:02d}{minute:02d}_{quote(region_raw)}'
            title = sanitize_text(f'[finance.lounge] {region} 로테이션 소개팅', 80)
            description = sanitize_text(note, 1000) if note else None

            try:
                events.append(EventModel(
                    title=title,
                    description=description,
                    event_date=event_date,
                    location_region=region,
                    source_url=f'{INSTAGRAM_URL}#{frag}',
                    is_closed=is_closed,
                    age_group_label=age_group_label,
                    age_range_min=age_range_min,
                    age_range_max=age_range_max,
                    age_male=age_male,
                    age_female=age_female,
                    attendee_image_url=attendee_image_url,
                    thumbnail_urls=[DEFAULT_THUMBNAIL],
                ))
            except Exception as e:
                self.logger.warning(f'파이낸스라운지 이벤트 생성 실패 {text!r}: {e}')

        self.logger.info(f'파이낸스라운지 {len(events)}개 이벤트 파싱')
        return events

    def _fetch_blocks(self) -> list[dict]:
        """노션 페이지를 실제 Chrome으로 렌더링해 data-block-id 요소를 DOM 순서대로 반환.
        번들 Chromium은 노션이 "호환 안 되는 브라우저" 오류 페이지로 막는다."""
        try:
            with sync_playwright() as p:
                # ⚠️ 2026-09-10. 구글 apt 저장소 장애로 진짜 Chrome 설치가 실패할 수 있다.
                #    그때 여기서 그냥 죽으면 «왜 안 되는지» 로그만 봐서는 알기 어려우므로,
                #    사유를 분명히 남기고 조용히 0건으로 끝낸다(다른 업체 크롤은 계속된다).
                try:
                    browser = p.chromium.launch(headless=True, channel='chrome', args=['--no-sandbox'])
                except Exception as e:
                    self.logger.warning(
                        '파이낸스라운지 건너뜀 — 진짜 Chrome 이 설치돼 있지 않다. '
                        f'노션이 번들 Chromium 을 막아서 대체 불가. ({str(e)[:80]})'
                    )
                    return []
                context = browser.new_context(locale='ko-KR', viewport={'width': 1280, 'height': 900})
                page = context.new_page()
                page.goto(NOTION_URL, timeout=30000, wait_until='domcontentloaded')
                page.wait_for_timeout(7000)
                blocks = page.eval_on_selector_all(
                    '[data-block-id]',
                    '''els => els.map(e => {
                        const img = e.querySelector('img');
                        return {
                            text: (e.innerText || '').trim(),
                            has_img: !!img,
                            img_src: img ? img.src : null,
                        };
                    })'''
                )
                browser.close()
                return blocks
        except Exception as e:
            self.logger.error(f'파이낸스라운지 노션 페이지 로드 실패: {e}')
            return []

    def _rehost_image(
        self, src: str, month: int, day: int, hour: int, minute: int, region_raw: str
    ) -> Optional[str]:
        """노션 프록시 이미지 URL은 시간이 지나면 만료되므로 R2로 재호스팅한다.
        키는 회차 식별자 기반 결정론적 해시 → 같은 회차는 항상 같은 키를 덮어써
        크롤 때마다(참석자가 채워지며 이미지가 갱신돼도) 고아 오브젝트가 쌓이지 않는다."""
        try:
            resp = httpx.get(src, timeout=20, follow_redirects=True)
            resp.raise_for_status()
            if not resp.content:
                return None
            h = hashlib.md5(f'{month:02d}{day:02d}_{hour:02d}{minute:02d}_{region_raw}'.encode()).hexdigest()[:10]
            key = f'attendee/finance-lounge/{month:02d}{day:02d}_{hour:02d}{minute:02d}_{h}.png'
            return upload_bytes(key, resp.content, content_type='image/png')
        except Exception as e:
            self.logger.warning(f'참석자 명단 이미지 재호스팅 실패({month}.{day} {hour}시): {e}')
            return None
