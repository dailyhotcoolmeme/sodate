"""발견은 했지만 저장 대상은 0건인 크롤을 정상으로 숨기지 않는다."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

import watchdog
from tests.test_base import MockScraper


@pytest.mark.parametrize('upcoming,applied,expected', [
    (True, 0, 'failed'), (False, 0, 'success'), (True, 1, 'success'),
])
def test_run_requires_actual_processing_when_upcoming_events_remain(upcoming, applied, expected):
    scraper = MockScraper()
    scraper.scrape = MagicMock(return_value=[object()])
    scraper.save_events = MagicMock(return_value=dict(new=0, updated=applied, deleted=0, failed=0))
    scraper._has_upcoming_events = MagicMock(return_value=upcoming)
    scraper.log_result = MagicMock()
    result = scraper.run()
    assert result['status'] == expected
    assert scraper.log_result.call_args.kwargs['events_found'] == 1
    if expected == 'failed':
        assert '반영 0건' in scraper.log_result.call_args.kwargs['error']


@pytest.mark.parametrize('new,updated,upcoming,expected', [
    (0, 0, True, 1), (0, 1, True, 0), (1, 0, True, 0),
    (0, 0, False, 0), (None, None, True, 0),
])
def test_watchdog_detects_existing_false_success_logs(new, updated, upcoming, expected):
    sb = MagicMock()
    log = dict(company_id='c', status='success', events_found=1,
               events_new=new, events_updated=updated, executed_at='2026-10-16T00:00:00Z')
    sb.table.return_value.select.return_value.execute.return_value.data = [{'id': 'c', 'name': '연숲'}]
    sb.table.return_value.select.return_value.gte.return_value.order.return_value.execute.return_value.data = [log]
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value.gte.return_value.limit.return_value.execute.return_value.data = [{'id': 'e'}] if upcoming else []
    with patch.object(watchdog, 'check_failing_crawls', return_value=[]), patch.object(watchdog, 'check_silent_crawls', return_value=[]):
        issues = watchdog.check_empty_crawls(sb)
    assert len(issues) == expected
    if expected:
        assert '반영 0건' in issues[0]['msg']


def test_false_success_does_not_reset_failure_duration():
    sb = MagicMock()
    now = datetime.now(timezone.utc)
    logs = [
        dict(company_id='c', status='failed', executed_at=now.isoformat()),
        dict(company_id='c', status='success', events_found=1, events_new=0,
             events_updated=0, executed_at=(now-timedelta(hours=12)).isoformat()),
        dict(company_id='c', status='success', events_found=1, events_new=1,
             events_updated=0, executed_at=(now-timedelta(days=2)).isoformat()),
    ]
    sb.table.return_value.select.return_value.gte.return_value.order.return_value.limit.return_value.execute.return_value.data = logs
    issues = watchdog.check_failing_crawls(sb, {'c': '연숲'})
    assert len(issues) == 1
    assert '2일' in issues[0]['msg']
