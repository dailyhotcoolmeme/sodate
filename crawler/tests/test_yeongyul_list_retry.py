from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import scrapers.yeongyul as module


def scraper():
    s = module.YeongyulScraper.__new__(module.YeongyulScraper)
    s.logger = MagicMock()
    s.collection_complete = True
    s.DELETE_STALE = True
    return s


def test_empty_list_retries_and_recovers_without_waiting_for_networkidle(monkeypatch):
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    page = MagicMock()
    page.goto.return_value.status = 200
    page.wait_for_load_state.side_effect = RuntimeError('persistent background request')
    expected = ['https://yeongyul.com/ab-1131-1117']
    page.eval_on_selector_all.side_effect = [[], expected]
    s = scraper()
    assert s._list_links(page, s.LIST_URL) == expected
    assert page.goto.call_count == 2
    assert s.collection_complete and s.DELETE_STALE


@pytest.mark.parametrize('status', [200, 503])
def test_unreadable_page_disables_stale_deletion(monkeypatch, status):
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    page = MagicMock()
    page.goto.return_value.status = status
    page.eval_on_selector_all.return_value = []
    s = scraper()
    with pytest.raises(RuntimeError, match='기존 일정 보존'):
        s._list_links(page, s.LIST_URL)
    assert not s.collection_complete and not s.DELETE_STALE
    assert page.goto.call_count == 2


def test_partial_collection_keeps_missing_future_and_verified_events(monkeypatch):
    from copy import deepcopy
    from datetime import datetime, timedelta, timezone
    from models.event import EventModel
    now = datetime.now(timezone.utc)
    rows = [dict(id='future', company_id='c', verified=False, is_active=True,
                 event_date=(now+timedelta(days=2)).isoformat(), source_url='https://example.com/missing'),
            dict(id='owner', company_id='c', verified=True, is_active=True,
                 event_date=(now-timedelta(days=2)).isoformat(), source_url='https://example.com/owner')]
    before = deepcopy(rows)
    class Query:
        def __init__(self): self.filters = []; self.deleting = False
        def select(self, *a, **kw): return self
        def delete(self): self.deleting = True; return self
        def eq(self, k, v): self.filters.append(lambda r: r.get(k) == v); return self
        def lt(self, k, v): self.filters.append(lambda r: r[k] < v); return self
        def execute(self):
            found = [r for r in rows if all(f(r) for f in self.filters)]
            if self.deleting:
                for row in found: rows.remove(row)
            return SimpleNamespace(data=found)
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    page = MagicMock(); page.goto.side_effect = RuntimeError('unavailable')
    s = scraper(); s.company_slug = 'yeongyul'
    with pytest.raises(RuntimeError): s._list_links(page, s.LIST_URL)
    s.get_company_id = lambda: 'c'; s._load_type_hashtags = lambda _: []
    s._select_all = lambda fields, **kw: [r for r in rows if all(r.get(k) == v for k,v in kw.items())]
    s.supabase = SimpleNamespace(table=lambda _: Query())
    event = EventModel(title='protected', event_date=now+timedelta(days=3),
                       location_region='강남', source_url='https://example.com/owner')
    assert s.save_events([event])['deleted'] == 0
    assert rows == before
