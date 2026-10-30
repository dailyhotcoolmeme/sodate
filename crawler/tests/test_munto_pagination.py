from unittest.mock import MagicMock
import scrapers.munto as module


def scraper():
    s = module.MuntoScraper.__new__(module.MuntoScraper)
    s.logger = MagicMock()
    s.collection_complete = True
    s.DELETE_STALE = True
    return s


def test_limit_200_and_offset_follow_even_short_page_has_more(monkeypatch):
    calls = []
    def get(client, url, params):
        calls.append(params)
        offset = params['offset']
        rows = [{'id': n} for n in range(offset + 1, min(offset + 201, 223))]
        return {'socialings': rows, 'hasMore': bool(rows)}
    monkeypatch.setattr(module, '_get', get)
    s = scraper()
    assert len(s._fetch_list(None, 12, 50)) == 222
    assert [x['offset'] for x in calls] == [0, 200, 222]
    assert all(x['limit'] == 200 for x in calls)
    assert s.collection_complete and s.DELETE_STALE


def test_failed_later_page_retains_collected_rows_and_disables_deletion(monkeypatch):
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    monkeypatch.setattr(module, '_get', lambda c,u,params:
        {'socialings':[{'id':1}], 'hasMore':True} if params['offset']==0 else None)
    s = scraper()
    assert s._fetch_list(None, 12, 1) == [{'id':1}]
    assert not s.collection_complete and not s.DELETE_STALE


def test_repeated_page_cannot_loop_or_delete_existing_events(monkeypatch):
    monkeypatch.setattr(module, '_get', lambda *a,**k: {'socialings':[{'id':1}], 'hasMore':True})
    s = scraper()
    assert s._fetch_list(None, 12, 1) == [{'id':1}]
    assert not s.collection_complete and not s.DELETE_STALE


def test_initial_api_error_is_partial_and_keeps_existing_events(monkeypatch):
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    monkeypatch.setattr(module, '_get', lambda *a,**k: None)
    s = scraper()
    assert s._fetch_list(None, 12, 50) == []
    assert not s.collection_complete and not s.DELETE_STALE


def test_partial_save_preserves_missing_future_and_verified_rows(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from copy import deepcopy
    from models.event import EventModel
    now = datetime.now(timezone.utc)
    rows = [dict(id='future', company_id='c', verified=False, is_active=True,
                 event_date=(now+timedelta(days=2)).isoformat(), source_url='https://example.com/missing'),
            dict(id='owner', company_id='c', verified=True, is_active=True,
                 event_date=(now-timedelta(days=2)).isoformat(), source_url='https://example.com/owner')]
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
                for row in found: rows.remove(row)
            return SimpleNamespace(data=found)
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    monkeypatch.setattr(module, '_get', lambda *a,**k: None)
    s = scraper(); s.company_slug='munto'
    s._fetch_list(None,12,50)
    s.get_company_id=lambda:'c'; s._load_type_hashtags=lambda _:[]
    s._select_all=lambda fields,**kw:[r for r in rows if all(r.get(k)==v for k,v in kw.items())]
    s.supabase=SimpleNamespace(table=lambda _:Query())
    protected=EventModel(title='do not overwrite',event_date=now+timedelta(days=3),
                         location_region='강남',source_url='https://example.com/owner')
    assert s.save_events([protected])['deleted'] == 0
    assert rows == before
