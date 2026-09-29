"""GitHub Actions 하트비트 감시 회귀 테스트."""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import watchdog


def test_latest_success_falls_back_when_status_filter_is_temporarily_empty():
    success = {
        'conclusion': 'success',
        'updated_at': '2026-09-29T00:00:00Z',
    }

    def fake_get(path):
        if 'status=success' in path:
            return {'workflow_runs': []}
        return {'workflow_runs': [
            {'conclusion': 'failure', 'updated_at': '2026-09-29T00:05:00Z'},
            success,
        ]}

    with patch.object(watchdog, '_gh_get', side_effect=fake_get) as gh_get:
        assert watchdog._latest_success_run('crawl.yml') == success

    assert gh_get.call_count == 2


def test_latest_success_reports_none_when_both_queries_have_no_success():
    responses = [
        {'workflow_runs': []},
        {'workflow_runs': [
            {'conclusion': 'failure'},
            {'conclusion': None},
        ]},
    ]
    with patch.object(watchdog, '_gh_get', side_effect=responses):
        assert watchdog._latest_success_run('crawl.yml') is None


def test_latest_success_does_not_make_fallback_request_when_filtered_query_works():
    success = {'conclusion': 'success', 'updated_at': '2026-09-29T00:00:00Z'}
    with patch.object(
        watchdog, '_gh_get', return_value={'workflow_runs': [success]}
    ) as gh_get:
        assert watchdog._latest_success_run('crawl.yml') == success

    gh_get.assert_called_once_with('crawl.yml/runs?status=success&per_page=1')
