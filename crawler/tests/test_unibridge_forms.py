import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import scrapers.unibridge_social as module
from scrapers.unibridge_social import UnibridgeSocialScraper, _parse_kor_hour

FORM = 'https://docs.google.com/forms/d/e/official-test/viewform'
SHORT = 'https://forms.gle/short-test'


@pytest.fixture
def scraper(monkeypatch):
    client = MagicMock()
    client.table.side_effect = AssertionError('Live DB forbidden in parser test')
    monkeypatch.setattr('scrapers.base_scraper.get_supabase', lambda: client)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 26, 9)
    monkeypatch.setattr(module, 'datetime', Clock)
    return UnibridgeSocialScraper()


def response(url, text):
    return SimpleNamespace(url=url, text=text, raise_for_status=lambda: None)


def form(options):
    items = [[1, '일정선택', None, 2, [[1, [[text] for text in options]]]],
             [2, '참가비 안내', '[ Male / 남성 ] 정상가 : 39,000원 할인 35,000원 [ Female / 여성 ] 정상가 : 29,000원', 2, None]]
    return 'var FB_PUBLIC_LOAD_DATA_ = ' + json.dumps([None, [None, items]]) + ';'


def test_direct_and_short_urls_are_discovered_and_deduplicated(scraper, monkeypatch):
    def get(url, **kwargs):
        if url == module.LINK_HUB_URL:
            return response(url, f'<a href="{FORM}">11월 신청</a><a href="{SHORT}">10월</a>')
        return response(FORM, 'form')
    monkeypatch.setattr(module.httpx, 'get', get)
    assert scraper._active_form_urls() == [FORM]


def test_failed_link_disables_stale_deletion(scraper, monkeypatch):
    def get(url, **kwargs):
        if url == module.LINK_HUB_URL:
            return response(url, FORM + ' ' + SHORT)
        if url == SHORT:
            raise RuntimeError('temporary failure')
        return response(FORM, 'form')
    monkeypatch.setattr(module.httpx, 'get', get)
    assert scraper._active_form_urls() == [FORM]
    assert not scraper.DELETE_STALE and not scraper.collection_complete


@pytest.mark.parametrize('final', ['https://example.com/viewform', 'https://docs.google.com/forms/d/e/old/closedform'])
def test_closed_or_untrusted_response_is_not_active(scraper, monkeypatch, final):
    monkeypatch.setattr(module.httpx, 'get', lambda url, **kw: response(url, SHORT) if url == module.LINK_HUB_URL else response(final, 'closed'))
    assert scraper._active_form_urls() == []


def test_schedule_values_and_explicit_closure(scraper, monkeypatch):
    html = form(['10/26(월) 강남 [저녁 7시] 99~07 ❌13:13 마감!!',
                 '11/2(월) 강남 [저녁 7시] 99~07 남성 마감',
                 '11/5(목) 합정 [오후 2시30분] 03~07',
                 '10/1(목) 합정 [오후 2시] 99~07'])
    monkeypatch.setattr(scraper, '_active_form_urls', lambda: [FORM])
    monkeypatch.setattr(module.httpx, 'get', lambda *a, **kw: response(FORM, html))
    events = scraper.scrape()
    assert len(events) == 3
    assert [(e.event_date.hour, e.event_date.minute, e.is_closed) for e in events] == [(19, 0, True), (19, 0, False), (14, 30, False)]
    assert all((e.price_male, e.price_female) == (39000, 29000) for e in events)
    assert events[0].age_male == '19~27' and events[2].age_male == '19~23'
    assert all(e.event_date.year == 2026 for e in events)


@pytest.mark.parametrize('text', ['7시', '오후 25시', '오후 0시'])
def test_unknown_time_not_invented(text):
    assert _parse_kor_hour(text) is None


def test_invalid_form_is_partial_and_preserves_future_rows(scraper, monkeypatch):
    monkeypatch.setattr(scraper, '_active_form_urls', lambda: [FORM])
    monkeypatch.setattr(module.httpx, 'get', lambda *a, **kw: response(FORM, 'unknown new form layout'))
    assert scraper.scrape() == []
    assert not scraper.DELETE_STALE and not scraper.collection_complete
    from refresh_soldout import _refresh_via_scraper
    from tests.test_refresh_scraper_safety import DB, row
    protected = row(1); protected['verified'] = True
    db = DB([protected, row(2)])
    _refresh_via_scraper(db, 'company', lambda: scraper)
    assert not db.writes
    assert all(not r['is_closed'] for r in db.rows)


def test_recheck_job_has_no_paid_crawl():
    source = (Path(__file__).resolve().parents[2] / '.github/workflows/crawl.yml').read_text()
    job = source.split('\n  unibridge_recheck:', 1)[1]
    assert 'UnibridgeSocialScraper().run()' in job
    assert 'APIFY_TOKEN' not in job and 'main.py' not in job
    assert source.count('inputs.unibridge_recheck != true') == 5
