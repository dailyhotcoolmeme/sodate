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
