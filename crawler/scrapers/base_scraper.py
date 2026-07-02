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

        for event in events:
            data = event.model_dump()
            data['company_id'] = company_id
            data['crawled_at'] = datetime.now(timezone.utc).isoformat()

            # 크롤러는 정원/잔여석/가격 정확도를 신뢰하지 않는다 — 항상 비움(관리자 직접 입력 전용).
            # 어떤 스크래퍼가 값을 채워 넣어도 여기서 일괄 None 처리되어 DB에 저장되지 않는다.
            data['capacity_male'] = None
            data['capacity_female'] = None
            data['seats_left_male'] = None
            data['seats_left_female'] = None
            data['price_male'] = None
            data['price_female'] = None

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

        return {'new': new_count, 'updated': updated_count}

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

    def run(self) -> dict:
        """전체 크롤링 실행 (스크래핑 → 저장 → 로그)"""
        start = time.time()
        try:
            self.logger.info(f"[{self.company_slug}] 크롤링 시작")
            events = self.scrape()
            self.logger.info(f"[{self.company_slug}] {len(events)}개 이벤트 발견")

            result = self.save_events(events)
            duration = int((time.time() - start) * 1000)

            self.log_result(
                status='success',
                events_found=len(events),
                new=result['new'],
                updated=result['updated'],
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
