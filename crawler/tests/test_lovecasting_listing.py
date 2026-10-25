from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from bs4 import BeautifulSoup

from scrapers.lovecasting import LovecastingScraper


def scraper():
    with patch('scrapers.base_scraper.get_supabase', return_value=MagicMock()):
        s = LovecastingScraper()
    s._fetch_thumbnail = lambda _: None
    return s


def card(date, hour, price_male=50000, price_female=20000):
    day = '월화수목금토일'[date.weekday()]
    return f'''<div class="elementor-widget-wrap"><div><a href="https://lovecasting.co.kr/{date:%y-%m-%d}-coffee/"><img src="badge.jpg"></a></div>
      <p>{date:%m.%d} | {day}요일 | PM {hour}:00 | 삼성역</p>
      <h2>[커피미팅] 직장인 로테이션 소개팅</h2><p>13명 접수중</p>
      <p>{price_male:,}원 남 35세~45세</p><p>{price_female:,}원 여 35세~45세</p></div>'''


def test_menu_items_do_not_hide_elementor_cards_or_mix_prices():
    d = datetime.now() + timedelta(days=7)
    html = '<div class="elementor-list-item">메뉴</div><section>' + card(d, 3) + card(d + timedelta(days=7), 7, 60000, 30000) + '</section>'
    events = scraper()._extract_cards_from_soup(BeautifulSoup(html, 'html.parser'), 'category')
    assert len(events) == 2
    assert [(e.event_date.hour, e.price_male, e.price_female) for e in events] == [(15, 50000, 20000), (19, 60000, 30000)]
    assert all('직장인' in e.title for e in events)


def test_expired_cards_are_not_rolled_into_next_year():
    html = card(datetime.now() - timedelta(days=7), 3)
    assert scraper()._extract_cards_from_soup(BeautifulSoup(html, 'html.parser'), 'category') == []


def test_static_official_cards_do_not_need_browser():
    response = MagicMock(text=card(datetime.now() + timedelta(days=7), 3))
    with patch('scrapers.lovecasting.httpx.get', return_value=response), \
         patch('scrapers.lovecasting.sync_playwright') as browser:
        assert len(scraper()._parse_listing_page('category')) == 1
        browser.assert_not_called()


def test_missing_gender_price_is_preserved_not_borrowed():
    html = card(datetime.now() + timedelta(days=7), 3).replace('20,000원', '')
    s = scraper()
    event = s._extract_cards_from_soup(BeautifulSoup(html, 'html.parser'), 'category')[0]
    assert event.price_male == 50000 and event.price_female is None
    assert s.PRESERVE_MISSING_PRICES


def test_unknown_listing_never_uses_invented_time_fallback():
    s = scraper()
    s._parse_listing_page = lambda _: []
    s._fetch_and_parse = MagicMock(side_effect=AssertionError('Guessed time fallback'))
    assert s._scrape_category('category') == []
    s._fetch_and_parse.assert_not_called()


def test_partial_category_disables_deletion_and_closure():
    s = scraper()
    s._scrape_category = MagicMock(side_effect=[[MagicMock(event_date=datetime.now()+timedelta(days=7))], []])
    assert len(s.scrape()) == 1
    assert not s.DELETE_STALE and not s.collection_complete
    from refresh_soldout import _refresh_via_scraper
    from tests.test_refresh_scraper_safety import DB, row
    db = DB([row(1), row(2)])
    _refresh_via_scraper(db, 'company', lambda: s)
    assert db.writes == []
    assert all(not r['is_closed'] for r in db.rows)


def test_recheck_job_is_isolated():
    source = (Path(__file__).resolve().parents[2] / '.github/workflows/crawl.yml').read_text()
    job = source.split('\n  lovecasting_recheck:', 1)[1]
    assert 'LovecastingScraper().run()' in job
    assert 'APIFY_TOKEN' not in job and 'main.py' not in job
    assert source.count('inputs.lovecasting_recheck != true') == 4
