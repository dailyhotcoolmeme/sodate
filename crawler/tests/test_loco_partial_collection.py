from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import watchdog
from models.event import EventModel
from tests.test_base import MockScraper


def test_partial_save_writes_confirmed_event_without_deleting_unseen_or_verified():
    scraper = MockScraper()
    scraper.partial_reason = '공식 시각 일부 미확인'
    scraper.DELETE_STALE = True
    scraper._load_type_hashtags = MagicMock(return_value=[])
    protected = 'https://example.com/verified'
    unseen = 'https://example.com/unseen'
    scraper._select_all = MagicMock(side_effect=lambda fields, **filters:
        [{'source_url': protected}] if filters.get('verified') else [{'source_url': unseen, 'id': 'keep'}])
    future = (datetime.now() + timedelta(days=3)).replace(hour=19, minute=30)
    events = [EventModel(title='공식 회차', event_date=future, location_region='수원', source_url=url)
              for url in ('https://example.com/confirmed', protected)]
    result = scraper.save_events(events)
    table = scraper.supabase.table.return_value
    table.upsert.assert_called_once()
    assert table.upsert.call_args.args[0]['source_url'] == 'https://example.com/confirmed'
    table.update.assert_not_called()
    table.delete.assert_not_called()
    assert result == dict(new=1, updated=1, deleted=0, failed=0)


def test_partial_run_does_not_claim_complete_success():
    scraper = MockScraper()
    scraper.partial_reason = '12월 원본 시각 미확인'
    scraper.scrape = MagicMock(return_value=[object()])
    scraper.save_events = MagicMock(return_value=dict(new=0, updated=4, deleted=0, failed=0))
    scraper.log_result = MagicMock()
    assert scraper.run()['status'] == 'partial'
    assert scraper.log_result.call_args.kwargs['error'] == scraper.partial_reason


def test_partial_result_does_not_silence_long_running_watchdog_alert():
    sb = MagicMock()
    now = datetime.now(timezone.utc)
    logs = [dict(company_id='c', status='partial', events_found=4, events_new=0,
                 events_updated=4, executed_at=now.isoformat()),
            dict(company_id='c', status='success', events_found=8, events_new=0,
                 events_updated=8, executed_at=(now-timedelta(days=3)).isoformat())]
    sb.table.return_value.select.return_value.gte.return_value.order.return_value.limit.return_value.execute.return_value.data = logs
    issues = watchdog.check_failing_crawls(sb, {'c': '로꼬'})
    assert len(issues) == 1 and issues[0]['persisted_days'] >= 3
    assert '4건 처리' in issues[0]['msg'] and '보존' in issues[0]['msg']


def test_loco_returns_confirmed_sessions_and_resets_partial_state_next_run():
    from unittest.mock import patch
    from scrapers.lovecommunity import LovecommunityLoco
    from utils.date_filter import KST
    scraper = LovecommunityLoco.__new__(LovecommunityLoco)
    scraper.logger = MagicMock()
    event = EventModel(title='공식 회차', event_date=datetime(2026,11,27,19,30),
                       location_region='수원', source_url='https://example.com/confirmed')
    scraper._collect_product_idxs = MagicMock(return_value=['1'])
    scraper._read_product_with_empty_retry = MagicMock(side_effect=[
        ({(11,27): {}, (12,4): {}}, [event]), ({(11,27): {}}, [event])])
    clock = MagicMock(wraps=datetime)
    clock.now.return_value = datetime(2026,11,25,9,tzinfo=KST)
    with patch('scrapers.lovecommunity.sync_playwright'), \
         patch('scrapers.lovecommunity.time.sleep'), \
         patch('scrapers.lovecommunity.datetime', clock), \
         patch('scrapers.lovecommunity.is_within_one_month', return_value=True):
        assert scraper.scrape() == [event]
        assert '12-04' in scraper.partial_reason
        assert scraper.scrape() == [event]
        assert scraper.partial_reason is None
