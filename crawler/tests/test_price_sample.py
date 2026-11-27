from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import price_accuracy_check as qa
from scrapers.frip import FripScraper, FRIP_BASE


def test_munto_price_only_uses_requested_detail_and_preserves_free_price():
    rows = [dict(source_url='https://www.munto.kr/ko/socialing?id=123'),
            dict(source_url='https://unexpected.example/123')]
    with patch('scrapers.munto._get', return_value={'price': 0}) as get:
        assert qa._munto_sample_prices(rows) == [dict(source_url=rows[0]['source_url'], price_male=0, price_female=0)]
        assert get.call_count == 1
        assert get.call_args.args[1].endswith('/socialing/123')


def test_modparty_sample_selects_exact_product_ids_and_never_saves():
    from scrapers.modparty import ModpartyScraper
    s = ModpartyScraper.__new__(ModpartyScraper)
    url = 'https://modparty.co.kr/shop_view/?idx=123#evt=202611141400'
    s.scrape = MagicMock(return_value=[SimpleNamespace(source_url=url), SimpleNamespace(source_url='other')])
    assert len(s.sample_prices([url])) == 1
    s.scrape.assert_called_once_with(product_ids={'123'})


def test_empty_modparty_sample_is_partial_without_browser_or_db_access():
    from scrapers.modparty import ModpartyScraper
    s = ModpartyScraper.__new__(ModpartyScraper)
    assert s.scrape(product_ids=set()) == []
    assert s.collection_complete is False and s.DELETE_STALE is False


@pytest.mark.parametrize('time_text, expected_count', [('⏰ 19:30~21:30', 1), ('시각 미정', 0)])
def test_modparty_sample_reads_requested_detail_even_when_list_has_no_products(time_text, expected_count):
    from scrapers.modparty import ModpartyScraper
    s = ModpartyScraper.__new__(ModpartyScraper)
    s._uid, s._pw, s._booking_counts = 'test-user', 'test-password', {}
    s.logger = MagicMock()
    date = datetime.now() + timedelta(days=7)
    code = date.strftime('%m%d')
    url = f'{s.BASE_URL}/shop_view/?idx=123#evt={date:%Y%m%d}1930'
    html = (f'<meta property="og:title" content="강남 와인 소개팅">'
            f'<p>{date.month}/{date.day}({s._WD[date.weekday()]})</p><p>{time_text}</p>')
    page = MagicMock()
    page.url = s.BASE_URL
    page.content.return_value = ''  # 목록/브라우저 렌더가 비어도 상세 HTTP 원본 사용
    playwright = MagicMock()
    browser = playwright.__enter__.return_value.chromium.launch.return_value
    browser.new_context.return_value.new_page.return_value = page
    with patch('scrapers.modparty.sync_playwright', return_value=playwright), \
         patch('scrapers.modparty.httpx.get', return_value=SimpleNamespace(text=html, status_code=200)) as get, \
         patch.object(s, '_fetch_booking_counts'), \
         patch.object(s, '_extract_gender_prices', return_value={code: {'male': (44000, False), 'female': (33000, False)}}), \
         patch.object(s, 'save_events', side_effect=AssertionError('표본은 DB 저장 금지')):
        events = s.sample_prices([url])
    assert len(events) == expected_count
    if events:
        assert (events[0].price_male, events[0].price_female) == (44000, 33000)
        assert events[0].event_date.hour == 19 and events[0].event_date.minute == 30
    assert get.call_args.args[0] == url.split('#')[0]
    assert [c.args[0] for c in page.goto.call_args_list] == [s.LOGIN_URL, url.split('#')[0]]
    assert s.collection_complete is False and s.DELETE_STALE is False


def test_frip_target_price_skips_other_schedule_options():
    s = FripScraper.__new__(FripScraper)
    s.logger = MagicMock()
    tomorrow = datetime.now(timezone.utc) + timedelta(days=2)
    other = tomorrow + timedelta(days=1)
    anchor = tomorrow.astimezone(timezone(timedelta(hours=9))).strftime('%Y%m%d%H%M')
    url = f'{FRIP_BASE}/products/123#evt={anchor}'
    s._fetch_detail = MagicMock(return_value={'title': '로테이션 소개팅'})
    s._fetch_schedules_multi = MagicMock(return_value=[
        dict(id='target', startedAt=tomorrow.timestamp()*1000),
        dict(id='other', startedAt=other.timestamp()*1000)])
    s._fetch_select_items = MagicMock(return_value=[])
    s.sample_prices([url])
    assert s._fetch_select_items.call_count == 1
    assert s._fetch_select_items.call_args.args[1] == 'target'
    assert s.collection_complete is False and s.DELETE_STALE is False
    # 정기 수집 경로는 표본 제한 없이 모든 회차의 옵션을 계속 확인한다.
    s._fetch_select_items.reset_mock()
    from scrapers.frip import MEETING_CATEGORY_ID
    s._product_to_events({'id': '123', '_category': MEETING_CATEGORY_ID}, MagicMock())
    assert s._fetch_select_items.call_count == 2


def test_audit_caps_heavy_vendor_requests_before_scraping_and_reports_missing_samples():
    rows = [dict(id=str(n), source_url=f'{FRIP_BASE}/products/{n}#evt=202611141400',
                 price_male=100, price_female=50) for n in range(400)]
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{'id':'c'}])
    cls = MagicMock()
    cls.return_value.sample_prices.return_value = []
    with patch.object(qa, '_nonimweb_scrapers', return_value={'frip':cls}), \
         patch.object(qa, 'select_all', return_value=rows):
        issues = qa.check_nonimweb_live(sb)
    assert len(cls.return_value.sample_prices.call_args.args[0]) == 6
    cls.return_value.scrape.assert_not_called()
    assert any('0건' in x['msg'] for x in issues)
