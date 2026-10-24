"""대표 최저가 폴백 금지와 날짜별 티어 분리 회귀 검사."""
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scrapers.modparty import ModpartyScraper
from tests.test_refresh_scraper_safety import DB, row
from refresh_soldout import _refresh_via_scraper


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch):
    """Parser tests must not require credentials or connect to the production DB."""
    client = MagicMock()
    client.table.side_effect = AssertionError('Unexpected DB access in parser test')
    monkeypatch.setattr('scrapers.base_scraper.get_supabase', lambda: client)


def build(prices):
    scraper = ModpartyScraper()
    date = (datetime.now() + timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0)
    code = date.strftime('%m%d')
    scraper._parse_date_code = lambda _: date
    events = scraper._build_events({'198': {
        'title': '수원 와인파티', 'badge_dates': {(date.month, date.day)},
        'time_text': '18:00~21:00', 'price': 24000,
        'text': '수원 와인파티 24,000원', 'prices_by_date': {code: prices},
    }}, {'198'})
    return scraper, events


@pytest.mark.parametrize('prices', [{}, {'male': (79000, False)}])
def test_incomplete_gender_options_never_use_product_base_price(prices):
    scraper, events = build(prices)
    assert len(events) == 1
    assert events[0].price_male is None
    assert events[0].price_female is None
    assert events[0].price_detail is None
    db = DB([row(1)])
    db.rows[0].update(source_url=events[0].source_url, price_male=79000,
                      price_female=44000, price_detail={'male': {'regular': 79000}})
    _refresh_via_scraper(db, 'company', lambda: SimpleNamespace(scrape=lambda: events))
    assert db.writes == []
    assert scraper.PRESERVE_MISSING_PRICES


def test_full_crawl_omits_unknown_prices_instead_of_clearing_them():
    scraper, events = build({})
    scraper.company_id = 'company'
    scraper.company_name = '모드파티'
    scraper.supabase = MagicMock()
    scraper.supabase.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    scraper.save_events(events)
    data = scraper.supabase.table.return_value.upsert.call_args.args[0]
    assert not any(key in data for key in ('price_male', 'price_female', 'price_detail'))


def test_confirmed_soldout_is_kept_even_if_other_gender_option_is_missing():
    _, events = build({'male': (79000, True)})
    assert events[0].seats_left_male == 0
    assert events[0].seats_left_female is None


def test_confirmed_flat_prices_clear_old_tiers_instead_of_preserving_them():
    _, events = build({'male': (30000, False), 'female': (20000, False)})
    assert events[0].price_detail == {}
    db = DB([row(1)])
    db.rows[0].update(source_url=events[0].source_url,
                      price_detail={'male': {'regular': 59000}})
    _refresh_via_scraper(db, 'company', lambda: SimpleNamespace(scrape=lambda: events))
    assert db.rows[0]['price_male'] == 30000
    assert db.rows[0]['price_detail'] == {}


def test_all_date_options_are_read_without_reusing_first_date_tiers(monkeypatch):
    s = ModpartyScraper()
    h1 = "_form_select_wrap_Oabcdef123456 'O111111111111', '10월17일(토)' 'O222222222222', '11월14일(토)'"
    s._load_option_html = lambda page, idx, sels: sels[0][2] if sels else h1
    monkeypatch.setattr('scrapers.modparty.parse_gender_tickets_html', lambda html: {
        'male': (79000, False), 'female': (44000, False),
        'male_tiers': {'regular': 79000, 'earlybird': 49000 if '10월' in html else 59000},
        'female_tiers': {'regular': 44000},
    })
    by_date = s._extract_gender_prices(None, '198')
    assert set(by_date) == {'1017', '1114'}
    assert by_date['1017']['male_tiers']['earlybird'] == 49000
    assert by_date['1114']['male_tiers']['earlybird'] == 59000
    for prices in by_date.values():
        _, events = build(prices)
        assert events[0].price_male == 79000
        assert events[0].price_female == 44000
        assert events[0].price_detail['male'] == prices['male_tiers']
