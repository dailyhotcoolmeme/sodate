"""BaseScraper 및 EventModel 단위 테스트"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.base_scraper import BaseScraper
from models.event import EventModel


class MockScraper(BaseScraper):
    """테스트용 BaseScraper 구현체"""

    def __init__(self):
        self.company_slug = 'test'
        self.company_id = 'test-uuid-1234'
        self.supabase = MagicMock()
        from utils.logger import get_logger
        self.logger = get_logger('test')

    def scrape(self) -> list[EventModel]:
        return [
            EventModel(
                title='테스트 소개팅 8:8',
                event_date=datetime(2026, 4, 1, 19, 0),
                location_region='강남',
                source_url='https://lovematching.kr/event/1',
            )
        ]


# ──────────────────────────────────────────────
# EventModel 테스트
# ──────────────────────────────────────────────

def test_event_model_thumbnail_limit():
    """썸네일은 최대 5개로 제한되어야 한다"""
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='강남',
        source_url='https://example.com',
        thumbnail_urls=['url1', 'url2', 'url3', 'url4', 'url5', 'url6'],
    )
    assert len(event.thumbnail_urls) == 5


def test_region_normalization_gangnam():
    """강남구 → 강남 으로 정규화되어야 한다"""
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='강남구',
        source_url='https://example.com',
    )
    assert event.location_region == '강남'


def test_region_normalization_hongdae():
    """마포 → 홍대 로 정규화되어야 한다"""
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='마포구',
        source_url='https://example.com',
    )
    assert event.location_region == '홍대'


def test_event_model_defaults():
    """기본값이 올바르게 설정되어야 한다"""
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='강남',
        source_url='https://example.com',
    )
    assert event.is_closed is False
    assert event.theme == []
    assert event.thumbnail_urls == []
    assert event.external_id is None


def test_event_model_required_fields():
    """필수 필드 누락 시 ValidationError 발생"""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        EventModel(
            title='test',
            # event_date 누락
            location_region='강남',
            source_url='https://example.com',
        )


# ──────────────────────────────────────────────
# BaseScraper 테스트
# ──────────────────────────────────────────────

def test_save_events_calls_upsert():
    """save_events가 supabase upsert를 호출해야 한다"""
    scraper = MockScraper()
    mock_execute = MagicMock(return_value=MagicMock(data=[{'id': 'uuid'}]))
    scraper.supabase.table.return_value.upsert.return_value.execute = mock_execute

    events = scraper.scrape()
    result = scraper.save_events(events)

    scraper.supabase.table.assert_called_with('events')
    assert result['new'] >= 0


def test_save_events_handles_error_gracefully():
    """저장 실패 시 예외가 전파되지 않고 계속 진행되어야 한다"""
    scraper = MockScraper()
    scraper.supabase.table.return_value.upsert.return_value.execute.side_effect = Exception(
        "DB 연결 실패"
    )

    events = scraper.scrape()
    # 예외 없이 완료되어야 함
    result = scraper.save_events(events)
    assert 'new' in result


def test_log_result_calls_insert():
    """log_result가 crawl_logs에 insert를 호출해야 한다"""
    scraper = MockScraper()
    mock_execute = MagicMock(return_value=MagicMock(data=[{}]))
    scraper.supabase.table.return_value.insert.return_value.execute = mock_execute

    scraper.log_result(
        status='success',
        events_found=5,
        new=3,
        updated=2,
        duration_ms=1200,
    )
    scraper.supabase.table.assert_called_with('crawl_logs')


def test_run_returns_success_dict():
    """run() 성공 시 status=success 딕셔너리 반환"""
    scraper = MockScraper()
    scraper.supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock(
        data=[{}]
    )
    scraper.supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{}]
    )

    result = scraper.run()
    assert result['status'] == 'success'


def test_run_returns_failed_dict_on_exception():
    """run() 실패 시 status=failed 딕셔너리 반환"""
    scraper = MockScraper()

    # scrape()가 예외를 던지도록 패치
    original_scrape = scraper.scrape
    scraper.scrape = MagicMock(side_effect=Exception("크롤링 오류"))
    # log_result도 mock
    scraper.supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{}]
    )

    result = scraper.run()
    assert result['status'] == 'failed'
    assert 'error' in result
