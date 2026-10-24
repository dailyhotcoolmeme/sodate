from datetime import datetime, timedelta

import pytest
from unittest.mock import MagicMock

from scrapers.modparty import ModpartyScraper
from refresh_soldout import _refresh_via_scraper
from tests.test_refresh_scraper_safety import DB, row


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch):
    """Time parsing must be testable without any live database credentials."""
    client = MagicMock()
    client.table.side_effect = AssertionError('Unexpected DB access in parser test')
    monkeypatch.setattr('scrapers.base_scraper.get_supabase', lambda: client)


@pytest.mark.parametrize('time_text', [None, '미정 (10월 17일)'])
def test_missing_time_is_not_invented_and_disables_stale_deletion(time_text):
    s = ModpartyScraper()
    date = (datetime.now() + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    s._parse_date_code = lambda code: date
    events = s._build_events({'1': {
        'title': '강남 와인 로테이션 소개팅', 'badge_dates': {(date.month, date.day)},
        'time_text': time_text,
    }}, {'1'})
    assert events == []
    assert s.collection_complete is False
    assert s.DELETE_STALE is False


def test_explicit_time_still_produces_schedule():
    s = ModpartyScraper()
    date = (datetime.now() + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    s._parse_date_code = lambda code: date
    events = s._build_events({'1': {
        'title': '강남 와인 로테이션 소개팅', 'badge_dates': {(date.month, date.day)},
        'time_text': '19:30~21:30',
    }}, {'1'})
    assert len(events) == 1
    assert (events[0].event_date.hour, events[0].event_date.minute) == (19, 30)
    assert s.collection_complete is True
    assert s.DELETE_STALE is True


def test_partial_scrape_cannot_close_unmatched_even_above_half():
    db = DB([row(i) for i in range(3)])

    class Partial:
        collection_complete = False

        def scrape(self):
            from types import SimpleNamespace
            return [SimpleNamespace(source_url=f'https://example.com/{i}') for i in range(2)]

    _refresh_via_scraper(db, 'company', Partial)
    assert db.writes == []
    assert all(not r['is_closed'] for r in db.rows)
