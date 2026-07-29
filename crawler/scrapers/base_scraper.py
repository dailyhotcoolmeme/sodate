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

    def get_company_id(self) -> str:
        if self.company_id:
            return self.company_id
        result = (
            self.supabase.table('companies')
            .select('id')
            .eq('slug', self.company_slug)
            .single()
            .execute()
        )
        self.company_id = result.data['id']
        return self.company_id

    @abstractmethod
    def scrape(self) -> list[EventModel]:
        """업체 사이트에서 이벤트 목록을 스크래핑하여 반환"""
        pass

    def save_events(self, events: list[EventModel]) -> dict:
        """이벤트를 Supabase에 upsert 저장"""
        company_id = self.get_company_id()
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
            data['company_id'] = company_id
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
            if derived_hashtags:
                data['hashtags'] = derived_hashtags
            else:
                data.pop('hashtags', None)

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

                # KST 기준 시간 검증: 소개팅 이벤트는 오전 10시 ~ 자정 사이
                dt_kst = dt.astimezone(KST)
                if not (10 <= dt_kst.hour <= 23):
                    self.logger.warning(
                        f"비정상 시간대 이벤트 건너뜀 ({dt_kst.strftime('%H:%M')} KST): {event.source_url}"
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
