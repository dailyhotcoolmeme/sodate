"""로꼬 동적 본문이 예외 없이 비는 CI 회귀 테스트."""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.lovecommunity import LovecommunityLoco


def _scraper():
    scraper = LovecommunityLoco.__new__(LovecommunityLoco)
    scraper.logger = MagicMock()
    return scraper


def test_empty_dynamic_body_reopens_product_once_and_recovers():
    scraper = _scraper()
    recovered = [object()]
    scraper._read_loaded_product = MagicMock(
        side_effect=[({}, []), ({(9, 27): {'male': None}}, recovered)]
    )
    page = MagicMock()

    with patch('scrapers.lovecommunity.time.sleep'):
        widget, events = scraper._read_product_with_empty_retry(
            page, '1', 'https://lovecommunity.imweb.me/party/?idx=1'
        )

    assert events is recovered
    assert (9, 27) in widget
    assert scraper._read_loaded_product.call_count == 2
    page.goto.assert_called_once_with(
        'https://lovecommunity.imweb.me/party/?idx=1', timeout=20000
    )


def test_nonempty_dynamic_body_does_not_reload_product():
    scraper = _scraper()
    first = [object()]
    scraper._read_loaded_product = MagicMock(return_value=({}, first))
    page = MagicMock()

    widget, events = scraper._read_product_with_empty_retry(
        page, '1', 'https://lovecommunity.imweb.me/party/?idx=1'
    )

    assert events is first
    assert widget == {}
    page.goto.assert_not_called()
    assert scraper._read_loaded_product.call_count == 1


def test_second_empty_response_stops_after_one_reload():
    scraper = _scraper()
    scraper._read_loaded_product = MagicMock(side_effect=[({}, []), ({}, [])])
    page = MagicMock()
    page.wait_for_load_state.side_effect = TimeoutError

    with patch('scrapers.lovecommunity.time.sleep'):
        widget, events = scraper._read_product_with_empty_retry(
            page, '1', 'https://lovecommunity.imweb.me/party/?idx=1'
        )

    assert widget == {}
    assert events == []
    assert scraper._read_loaded_product.call_count == 2
    assert page.goto.call_count == 1
