import re
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone, timedelta
from typing import Optional

KST = timezone(timedelta(hours=9))

from models.event import EventModel
from utils.supabase_client import get_supabase
from utils.logger import get_logger
from utils.date_filter import is_within_one_month
from utils.hashtags import derive_hashtags
from utils.thumbnail import optimize_thumbnails


# 오류 페이지의 <title>이 모임명으로 저장되는 것을 막는다.
# 2026-07-30: 모드파티 상세가 일시적으로 403을 내던 순간에 크롤이 돌아
# 앱에 "[모드파티] Error 403 (Forbidden)" 이라는 모임 2건이 노출됐다.
# 업체마다 다른 CDN/서버 오류 페이지를 다 알 수 없으니 공통 지점에서 걸러낸다.
# 정상 제목의 '403호' 같은 표기를 잡지 않도록, 숫자 단독은 오류 문구와 함께 있을 때만 본다.
_ERROR_TITLE_RE = re.compile(
    r'(error\s*\d{3}'
    r'|\b(?:40[0-9]|41[0-9]|429|50[0-9])\b\s*(?:error|forbidden|not\s*found)'
    r'|forbidden|not\s+found|bad\s*gateway|service\s*unavailable'
    r'|gateway\s*time\s*-?\s*out|access\s*denied|접근\s*거부|잘못된\s*요청)',
    re.IGNORECASE,
)


# 업체 접두사("[로꼬] " 등)를 떼고 남은 게 HTTP 상태코드 숫자 하나뿐이면 오류 페이지다.
# 2026-08-14: 로꼬 상세가 403을 내던 순간 그 페이지 <title>이 그냥 "403"이었다.
# 위 정규식은 숫자 뒤에 error/forbidden 같은 단어가 붙은 것만 잡게 되어 있어 이걸
# 통째로 빠져나갔고, "[로꼬] 403"이라는 모임 2건이 15일간 앱에 노출됐다.
_BARE_STATUS_TITLE_RE = re.compile(r'^\s*(?:\[[^\]]{1,20}\]\s*)?[1-5]\d{2}\s*$')


def looks_like_error_title(title: Optional[str]) -> bool:
    """모임명이 서버 오류 페이지에서 긁혀온 것처럼 보이면 True."""
    if not title:
        return False
    return bool(_ERROR_TITLE_RE.search(title)) or bool(_BARE_STATUS_TITLE_RE.match(title))


class BaseScraper(ABC):
    # 기본은 가격/좌석을 크롤러가 안 쓴다(관리자 전용). 단, 업체 공식 소스에서
    # 정확히 뽑는 스크래퍼는 WRITES_PRICE=True 로 가격을 채운다(예: 모드파티).
    WRITES_PRICE = False

    # True면 이번 크롤에 없는 미검증 이벤트를 삭제한다(매진·삭제된 옛 회차 자동 정리).
    # 업체 공식 소스에서 전체 일정을 안정적으로 뽑는 스크래퍼만 켠다(예: 모드파티).
    DELETE_STALE = False

    # True면 좌석/정원도 크롤러가 채운다(품절·잔여석 표시용). 업체 공식소스에서 정확히 뽑는 경우만.
    WRITES_SEATS = False

    # True면 성별 나이(age_male/female)의 정본이다 → None도 그대로 기록해 옛 값을 지운다.
    # (기본 False: 나이 미설정 스크래퍼가 기존값 지우지 않도록 None은 upsert에서 제외)
    WRITES_AGE = False

    def __init__(self, company_slug: str):
        self.company_slug = company_slug
        self.supabase = get_supabase()
        self.logger = get_logger(company_slug)
        self.company_id: Optional[str] = None
        self.company_name: Optional[str] = None

    def get_company_id(self) -> str:
        if self.company_id:
            return self.company_id
        # name도 같이 가져와 캐싱(2026-08-14) — events.company_name(검색용) 채우는 데 씀.
        # 쿼리 자체는 그대로(컬럼만 하나 늘림), 추가 왕복 없음.
        result = (
            self.supabase.table('companies')
            .select('id,name')
            .eq('slug', self.company_slug)
            .single()
            .execute()
        )
        self.company_id = result.data['id']
        self.company_name = result.data['name']
        return self.company_id

    @abstractmethod
    def scrape(self) -> list[EventModel]:
        """업체 사이트에서 이벤트 목록을 스크래핑하여 반환"""
        pass

    def _load_type_hashtags(self, company_id: str) -> list[dict]:
        """이 업체의 상세 이미지 유형 중 해시태그가 등록된 것들.
        매칭 규칙은 admin(matchImageType.ts)·앱(resolveDescImages)과 동일해야 한다:
        제목에 검색어가 들어가면 그 유형, 여러 개면 걸린 검색어가 가장 긴 쪽이 이긴다."""
        try:
            rows = (
                self.supabase.table('company_image_types')
                .select('match_keywords,hashtags')
                .eq('company_id', company_id)
                .execute()
            ).data or []
            return [r for r in rows if r.get('hashtags')]
        except Exception:
            return []

    @staticmethod
    def _type_hashtags_for(title: str, typed: list[dict]) -> Optional[list]:
        hay = (title or '').lower()
        best = None  # (len, hashtags)
        for t in typed:
            for k in (t.get('match_keywords') or []):
                k = str(k).strip()
                if k and k.lower() in hay:
                    if best is None or len(k) > best[0]:
                        best = (len(k), t['hashtags'])
        return best[1] if best else None

    def save_events(self, events: list[EventModel]) -> dict:
        """이벤트를 Supabase에 upsert 저장"""
        company_id = self.get_company_id()
        # 오너가 상세 이미지 유형에 등록한 해시태그(2026-07-29). 매칭되는 모임은
        # 자동 생성 태그 대신 이걸 단다. 없으면 기존대로.
        typed_hashtags = self._load_type_hashtags(company_id)
        new_count = 0
        updated_count = 0
        current_urls = {e.source_url for e in events}

        # 관리자 검증완료(verified) 이벤트는 크롤러가 절대 건드리지 않는다 → 입력한 가격·연령 영구 보존.
        verified_urls: set = set()
        try:
            vres = (
                self.supabase.table('events')
                .select('source_url')
                .eq('company_id', company_id)
                .eq('verified', True)
                .execute()
            )
            for row in (vres.data or []):
                if row.get('source_url'):
                    verified_urls.add(row['source_url'])
        except Exception as e:
            self.logger.warning(f"verified 목록 조회 실패(계속 진행): {e}")

        for event in events:
            # 검증완료 이벤트는 스킵(관리자 입력값 보존)
            if event.source_url in verified_urls:
                updated_count += 1
                continue

            data = event.model_dump()

            # 오류 페이지 제목은 저장하지 않는다. 이번 응답을 못 믿는 상황이므로
            # 기존 행도 건드리지 않고 넘긴다(정상 응답 때 갱신된다).
            if looks_like_error_title(data.get('title')):
                self.logger.warning(f"오류 페이지 제목으로 보여 건너뜀: {data.get('title')!r} ({event.source_url})")
                current_urls.discard(event.source_url)
                continue

            data['company_id'] = company_id
            # 검색용 동기화 컬럼(2026-08-14) — DB 트리거로 하다가 크롤러 대량 upsert와
            # 겹쳐 리소스 고갈로 서비스 전체가 멈춘 사고가 있어(20260814b 마이그레이션
            # 참고), 트리거 대신 이미 아는 값을 그냥 같이 써넣는 방식으로 바꿨다 —
            # 추가 쿼리 없음.
            if self.company_name:
                data['company_name'] = self.company_name
            data['crawled_at'] = datetime.now(timezone.utc).isoformat()

            # 정원/잔여석/가격은 기본적으로 크롤러가 쓰지 않는다(관리자 전용). upsert 데이터에서 제거 →
            # 신규 행은 NULL, 기존 행은 관리자 입력값이 덮이지 않는다.
            # 단, WRITES_PRICE 스크래퍼는 업체 공식소스에서 뽑은 가격을 유지한다.
            # 남·여 모두 매진이면 이벤트 전체 마감(is_closed=True) → 앱 마감 오버레이 표시.
            # WRITES_SEATS(좌석 신뢰) 업체만. 스크래퍼가 이미 True로 준 값은 유지.
            if self.WRITES_SEATS:
                _sm = data.get('seats_left_male')
                _sf = data.get('seats_left_female')
                # 원본 사이트 오버부킹 등으로 음수가 나올 수 있음 — DB check constraint(>=0)
                # 위반으로 이 행만 조용히 저장 실패하던 것 방지(2026-07-25, 프립에서 발견).
                if _sm is not None and _sm < 0:
                    _sm = data['seats_left_male'] = 0
                if _sf is not None and _sf < 0:
                    _sf = data['seats_left_female'] = 0
                _both_sold = (_sm is not None and _sf is not None and _sm <= 0 and _sf <= 0)
                data['is_closed'] = bool(data.get('is_closed')) or _both_sold

            _strip = []
            if not self.WRITES_SEATS:
                _strip += ['capacity_male', 'capacity_female', 'seats_left_male', 'seats_left_female']
            if not self.WRITES_PRICE:
                _strip += ['price_male', 'price_female']
            for _k in _strip:
                data.pop(_k, None)

            # ⚠️ 크롤러가 값을 안 준(None) 성별 나이표시는 upsert에서 제외 → 기존값(스크래퍼/관리자 입력) 보존.
            #    (age_male/female를 세팅 안 하는 스크래퍼가 기존 나이를 None으로 덮어써 지우던 버그 방지)
            #    단 WRITES_AGE(나이 정본) 업체는 None도 기록해 옛 잘못된 값을 지운다.
            if not self.WRITES_AGE:
                for _k in ('age_male', 'age_female'):
                    if data.get(_k) is None:
                        data.pop(_k, None)

            # 썸네일이 비었으면 upsert에서 제외 → 기존 썸네일을 빈 배열로 지우지 않는다.
            # (목록 API에서 빠진 상품을 ID로만 재조회할 때 썸네일이 안 딸려오는 경우 대비)
            if not data.get('thumbnail_urls'):
                data.pop('thumbnail_urls', None)
            else:
                # 업체 CDN 원본을 그대로 쓰면 피드가 무거워진다(imweb 평균 907KB·최대 1.4MB).
                # 900px WebP 로 다시 구워 R2 에 재호스팅한다 — 자세한 근거와 실측은
                # utils/thumbnail.py 주석 참고. 실패하면 원본 URL 이 그대로 남아 크롤은 안 깨진다.
                data['thumbnail_urls'] = optimize_thumbnails(data['thumbnail_urls'])

            # 참석자 명단 이미지도 같은 이유로 None이면 upsert에서 제외(기존 값 보존).
            # R2 재업로드가 일시적으로 실패해도 이미 있던 이미지를 지우지 않는다 —
            # 실제 삭제는 아래 '지난 일정 정리'에서 R2 원본과 함께 명시적으로만 한다.
            if data.get('attendee_image_url') is None:
                data.pop('attendee_image_url', None)

            # 테마는 구분하지 않는다 — 전부 소개팅. 스크래퍼가 뭘 넣든 일괄 고정.
            data['theme'] = ['소개팅']

            # 해시태그 자동 생성 (admin 검수·수정 대상). theme는 그대로 두고 hashtags만 채운다.
            # 매칭이 없어 빈 배열이면 upsert에서 제외 → 기존(admin 편집) 값을 빈 배열로 덮지 않는다.
            derived_hashtags = derive_hashtags(
                title=data.get('title'),
                description=data.get('description'),
                region=data.get('location_region'),
                age_min=data.get('age_range_min'),
                age_max=data.get('age_range_max'),
                extra=data.get('format'),
            )
            # 유형 해시태그가 매칭되면 그것이 우선(오너 큐레이션). 자동 태그는 그다음.
            type_tags = self._type_hashtags_for(data.get('title') or '', typed_hashtags)
            if type_tags:
                data['hashtags'] = type_tags
            elif derived_hashtags:
                data['hashtags'] = derived_hashtags
            else:
                data.pop('hashtags', None)

            # hashtags를 이번에 실제로 쓸 때만 검색용 합친 문자열도 같이 채운다 —
            # hashtags를 안 건드리는 경우(기존/admin 편집값 보존) hashtags_search도
            # 건드리지 않아야 서로 안 어긋난다.
            if 'hashtags' in data:
                data['hashtags_search'] = ' '.join(data['hashtags'])

            if isinstance(data['event_date'], datetime):
                dt = data['event_date']
                if dt.tzinfo is None:
                    # timezone 없는 datetime은 KST로 간주 후 UTC 변환
                    dt = dt.replace(tzinfo=KST).astimezone(timezone.utc)
                data['event_date'] = dt.isoformat()

                # 날짜 필터: 오늘 ~ 오늘+31일 범위만 저장
                if not is_within_one_month(dt):
                    self.logger.debug(
                        f"날짜 범위 초과 이벤트 건너뜀 ({dt.astimezone(KST).strftime('%Y-%m-%d')} KST): {event.source_url}"
                    )
                    continue

                # KST 기준 시간 검증 — 소개팅 모임은 오전 10시~밤 10시 사이에만 열린다
                # (오너 확인 2026-08-17). 요일은 구분하지 않는다: 실측상 평일에도 13~15시
                # 낮 모임(카페 자만추 등)이 상당수라 요일로 나누면 멀쩡한 게 잘려나간다.
                #
                # ⚠️ 상한이 23시였을 땐 23:50이 그대로 통과했다. 이 범위를 벗어난 값은 대개
                #    '모임 시각'이 아니다 — 문토 편지소개팅(id=670534)은 우편으로 진행해
                #    모일 자리가 아예 없는데 startDate에 '모집 마감'인 23:50이 들어와
                #    앱 목록 첫 줄에 떴다(오너 제보). 틀린 시간을 보여주느니 안 올린다.
                dt_kst = dt.astimezone(KST)
                if not (10 <= dt_kst.hour <= 21):
                    self.logger.warning(
                        f"모임 시간대(10~22시) 밖이라 건너뜀 ({dt_kst.strftime('%m/%d %H:%M')} KST): "
                        f"{(data.get('title') or '')[:40]} | {event.source_url}"
                    )
                    continue

            # age_range DB constraint 사전 검증 (age_range_min >= 18, age_range_max <= 60)
            if data.get('age_range_min') is not None and data['age_range_min'] < 18:
                self.logger.debug(
                    f"age_range_min 범위 초과({data['age_range_min']}) → None으로 초기화: {event.source_url}"
                )
                data['age_range_min'] = None
            if data.get('age_range_max') is not None and data['age_range_max'] > 60:
                self.logger.debug(
                    f"age_range_max 범위 초과({data['age_range_max']}) → None으로 초기화: {event.source_url}"
                )
                data['age_range_max'] = None

            try:
                result = (
                    self.supabase.table('events')
                    .upsert(data, on_conflict='source_url')
                    .execute()
                )
                if result.data:
                    new_count += 1
            except Exception as e:
                self.logger.error(
                    f"이벤트 저장 실패: {event.source_url} - {e} "
                    f"(저장 시도한 데이터: age_range_min={data.get('age_range_min')}, "
                    f"age_range_max={data.get('age_range_max')})"
                )
                # 해당 이벤트만 스킵하고 계속 진행

        # 지난 일정 정리 — 앱에 안 보이는데 DB에만 쌓여 스테일 판정(아래)의 분모를 왜곡한다.
        # 하루 여유를 둬서 당일 밤 일정이 시간대 오차로 지워지는 걸 막는다. verified는 보존.
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            # 행을 지우기 전에 attendee_image_url을 먼저 확보해야 한다 — 지운 뒤엔 값을
            # 조회할 방법이 없어 R2에 원본 이미지만 영원히 남는다(2026-08-11).
            stale_rows = (
                self.supabase.table('events')
                .select('id,attendee_image_url')
                .eq('company_id', company_id)
                .eq('verified', False)
                .lt('event_date', cutoff)
                .execute()
            ).data or []
            for row in stale_rows:
                if row.get('attendee_image_url'):
                    from utils.r2_client import delete_by_public_url
                    delete_by_public_url(row['attendee_image_url'])
            past = (
                self.supabase.table('events')
                .delete()
                .eq('company_id', company_id)
                .eq('verified', False)
                .lt('event_date', cutoff)
                .execute()
            )
            if past.data:
                self.logger.info(f"[{self.company_slug}] 지난 일정 {len(past.data)}개 정리")
        except Exception as e:
            self.logger.warning(f"[{self.company_slug}] 지난 일정 정리 실패(계속): {e}")

        # 이번 크롤에 없는 미검증 이벤트 정리(매진·삭제·시간변경된 옛 회차). verified는 절대 안 건드림.
        deleted = 0
        if self.DELETE_STALE and current_urls:
            try:
                existing = (
                    self.supabase.table('events')
                    .select('id,source_url')
                    .eq('company_id', company_id)
                    .eq('verified', False)
                    .execute()
                )
                rows = existing.data or []
                stale_ids = [r['id'] for r in rows if r['source_url'] not in current_urls]

                # ⚠️ 부분 실패 방어. 사이트가 잠깐 죽거나 상품 목록을 절반만 긁어온 크롤에서
                #    그대로 지우면 멀쩡한 일정이 통째로 날아간다. 이번 크롤이 기존 대비
                #    너무 적게 가져왔으면 삭제를 건너뛴다(다음 정상 크롤에서 정리됨).
                #    '빈 배열이면 스킵'만으로는 9개 중 3개만 긁힌 경우를 못 막는다.
                keep = len(rows) - len(stale_ids)          # 이번에도 확인된 기존 이벤트
                if rows and keep < len(rows) * 0.5:
                    self.logger.warning(
                        f"[{self.company_slug}] 스테일 정리 건너뜀 — 기존 {len(rows)}건 중 "
                        f"{keep}건만 재확인됨(부분 실패 의심). 삭제 후보 {len(stale_ids)}건 보존"
                    )
                    stale_ids = []

                for i in range(0, len(stale_ids), 50):
                    self.supabase.table('events').delete().in_('id', stale_ids[i:i + 50]).execute()
                deleted = len(stale_ids)
                if deleted:
                    self.logger.info(f"[{self.company_slug}] 스테일 이벤트 {deleted}개 삭제(이번 크롤에 없음)")
            except Exception as e:
                self.logger.warning(f"[{self.company_slug}] 스테일 정리 실패(계속): {e}")

        return {'new': new_count, 'updated': updated_count, 'deleted': deleted}

    def log_result(
        self,
        status: str,
        events_found: int,
        new: int,
        updated: int,
        error: Optional[str] = None,
        duration_ms: int = 0,
    ):
        """크롤링 결과를 crawl_logs에 기록"""
        try:
            self.supabase.table('crawl_logs').insert({
                'company_id': self.get_company_id(),
                'status': status,
                'events_found': events_found,
                'events_new': new,
                'events_updated': updated,
                'error_message': error,
                'duration_ms': duration_ms,
            }).execute()
        except Exception as e:
            self.logger.error(f"crawl_logs 기록 실패: {e}")

    def _has_upcoming_events(self) -> bool:
        """이 업체에 앞으로 일정이 DB에 남아 있는지. 0건 크롤이 진짜 이상인지 판단용."""
        try:
            res = (
                self.supabase.table('events')
                .select('id', count='exact')
                .eq('company_id', self.get_company_id())
                .gte('event_date', datetime.now(timezone.utc).isoformat())
                .limit(1)
                .execute()
            )
            return (res.count or 0) > 0
        except Exception:
            return False   # 판단 못 하면 기존대로 success (오탐으로 알림 남발 방지)

    def run(self) -> dict:
        """전체 크롤링 실행 (스크래핑 → 저장 → 로그)"""
        start = time.time()
        try:
            self.logger.info(f"[{self.company_slug}] 크롤링 시작")
            events = self.scrape()
            self.logger.info(f"[{self.company_slug}] {len(events)}개 이벤트 발견")

            result = self.save_events(events)
            duration = int((time.time() - start) * 1000)

            # ⚠️ 0건인데 'success'로 남기면 아무도 모르는 채 그 업체 데이터가 낡아간다.
            #    사이트가 느려 상품 파싱이 무더기로 실패해도 예외가 아니라 조용히 0건이
            #    된다(2026-07-29 에모셔널오렌지: 252건 → 0건이 success로 기록됨).
            #    앞으로 일정이 남아 있는데 0건을 들고 왔으면 실패로 기록해 워치독이 잡게 한다.
            status = 'success'
            error_msg = None
            if not events and self._has_upcoming_events():
                status = 'failed'
                error_msg = '수집 0건 — 기존 일정이 있는데 아무것도 못 가져옴(사이트 지연·파싱 깨짐 의심)'
                self.logger.error(f"[{self.company_slug}] {error_msg}")

            self.log_result(
                status=status,
                events_found=len(events),
                new=result['new'],
                updated=result['updated'],
                error=error_msg,
                duration_ms=duration,
            )
            self.logger.info(
                f"[{self.company_slug}] 완료 - 신규: {result['new']}, 업데이트: {result['updated']}"
            )
            return {'status': 'success', **result}

        except Exception as e:
            duration = int((time.time() - start) * 1000)
            self.logger.error(f"[{self.company_slug}] 크롤링 실패: {e}")
            self.log_result(
                status='failed',
                events_found=0,
                new=0,
                updated=0,
                error=str(e),
                duration_ms=duration,
            )
            return {'status': 'failed', 'error': str(e)}
