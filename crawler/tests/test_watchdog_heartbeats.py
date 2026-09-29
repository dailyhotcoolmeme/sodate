"""GitHub Actions 하트비트 감시 회귀 테스트."""
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import watchdog


ROOT = Path(__file__).resolve().parents[2]


def test_main_crawl_has_only_cloudflare_as_regular_scheduler():
    """GitHub schedule과 CF cron을 동시에 켜 Apify를 중복 호출한 사고 방지."""
    workflow = (ROOT / '.github/workflows/crawl.yml').read_text()
    scheduler = (
        ROOT / 'cloudflare/workers/sodate-scheduler/src/index.ts'
    ).read_text()

    assert '\n  schedule:' not in workflow
    assert "'0 23 * * *': { workflow: 'crawl.yml'" in scheduler
    assert "'0 11 * * *': { workflow: 'crawl.yml'" in scheduler


def test_latest_success_uses_recent_runs_when_status_filter_is_temporarily_empty():
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


def test_latest_success_replaces_stale_filtered_result_with_newer_recent_success():
    stale = {
        'conclusion': 'success',
        'updated_at': '2026-09-11T00:00:00Z',
    }
    newest = {
        'conclusion': 'success',
        'updated_at': '2026-09-29T00:00:00Z',
    }
    responses = [
        {'workflow_runs': [stale]},
        {'workflow_runs': [newest, {'conclusion': 'failure'}]},
    ]

    with patch.object(watchdog, '_gh_get', side_effect=responses):
        assert watchdog._latest_success_run('crawl.yml') == newest


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


def test_latest_success_uses_filtered_result_if_recent_query_fails():
    success = {'conclusion': 'success', 'updated_at': '2026-09-29T00:00:00Z'}
    with patch.object(watchdog, '_gh_get', side_effect=[
        {'workflow_runs': [success]},
        RuntimeError('temporary API failure'),
    ]) as gh_get:
        assert watchdog._latest_success_run('crawl.yml') == success

    assert gh_get.call_count == 2
