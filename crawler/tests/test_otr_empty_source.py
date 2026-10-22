from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from scrapers.otr_lounge import OtrLoungeScraper
from scrapers.base_scraper import BaseScraper
import watchdog


KNOWN = ['참가자 현황✨', '📸 [인스타그램] @otr.lounge_', '💬 [카카오톡] 공식 카카오톡 채널']


def scraper(buttons):
    s = OtrLoungeScraper.__new__(OtrLoungeScraper)
    s.company_slug = 'otr-lounge'
    s.logger = MagicMock()
    s._fetch_buttons = lambda: buttons
    return s


def test_only_exact_known_nonschedule_list_confirms_empty_source():
    s = scraper(KNOWN)
    assert s.scrape() == [] and s.empty_source_confirmed is True
    s._fetch_buttons = lambda: []
    assert s.scrape() == [] and s.empty_source_confirmed is False


@pytest.mark.parametrize('buttons', [[], KNOWN[:2], KNOWN+['10월 31일 신규 신청'], ['접속 오류']])
def test_missing_unknown_or_changed_buttons_keep_alert_path(buttons):
    s = scraper(buttons)
    assert s.scrape() == [] and s.empty_source_confirmed is False


@pytest.mark.parametrize('upcoming', [False, True])
def test_normal_run_logs_evidence_only_if_no_existing_future_event(upcoming):
    s = scraper(KNOWN)
    s._has_upcoming_events = lambda: upcoming
    s.save_events = MagicMock(return_value=dict(new=0, updated=0, deleted=0, failed=0))
    s.log_result = MagicMock()
    result = BaseScraper.run(s)
    assert result['status'] == ('failed' if upcoming else 'success')
    error = s.log_result.call_args.kwargs['error']
    assert error.startswith('NO_PUBLISHED_EVENTS:') is (not upcoming)


@pytest.mark.parametrize('marker,future,expected', [
    ('NO_PUBLISHED_EVENTS: 원본 목록 정상', [], 0),
    ('NO_PUBLISHED_EVENTS: 원본 목록 정상', [{'id':'new'}], 1),
    (None, [], 1),
])
def test_watchdog_only_excludes_source_confirmed_empty_without_future_rows(marker, future, expected):
    sb = MagicMock()
    company = SimpleNamespace(data=[dict(id='c',name='오프더레코드')])
    log = SimpleNamespace(data=[dict(company_id='c',status='success',events_found=0,error_message=marker)])
    def table(name):
        q = MagicMock()
        for method in ['select','gte','order','eq','limit']:
            getattr(q,method).return_value = q
        q.execute.return_value = {'companies':company,'crawl_logs':log,'events':SimpleNamespace(data=future)}[name]
        return q
    sb.table.side_effect = table
    with patch.object(watchdog,'check_failing_crawls',return_value=[]), \
         patch.object(watchdog,'check_silent_crawls',return_value=[]):
        assert len(watchdog.check_empty_crawls(sb)) == expected


def test_empty_collection_does_not_delete_future_or_verified_events():
    from copy import deepcopy
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    rows = [dict(id='future', company_id='c', verified=False, is_active=True,
                 event_date=(now+timedelta(days=3)).isoformat(), source_url='future'),
            dict(id='verified', company_id='c', verified=True, is_active=True,
                 event_date=(now-timedelta(days=3)).isoformat(), source_url='verified')]
    before = deepcopy(rows)
    class Query:
        def __init__(self): self.filters=[]; self.deleting=False
        def select(self,*a,**kw): return self
        def delete(self): self.deleting=True; return self
        def eq(self,k,v): self.filters.append(lambda r:r.get(k)==v); return self
        def lt(self,k,v): self.filters.append(lambda r:r[k]<v); return self
        def execute(self):
            found=[r for r in rows if all(f(r) for f in self.filters)]
            if self.deleting:
                for r in found: rows.remove(r)
            return SimpleNamespace(data=found)
    s = scraper([]); s.get_company_id=lambda:'c'
    s._load_type_hashtags=lambda *a:[]
    s._select_all=lambda fields,**kw:[r for r in rows if all(r.get(k)==v for k,v in kw.items())]
    s.supabase=SimpleNamespace(table=lambda *a:Query())
    assert s.save_events([])['deleted'] == 0
    assert rows == before


def test_source_recheck_workflow_excludes_paid_crawl_and_followup_jobs():
    from pathlib import Path
    source=(Path(__file__).resolve().parents[2]/'.github/workflows/crawl.yml').read_text()
    assert "inputs.yeonsoop_replay != true && inputs.otr_recheck != true" in source
    job=source.split('\n  otr_recheck:',1)[1]
    assert 'APIFY_TOKEN' not in job and 'main.py' not in job
    assert 'OtrLoungeScraper().run()' in job
