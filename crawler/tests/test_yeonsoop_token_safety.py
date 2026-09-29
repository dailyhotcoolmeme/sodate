"""연숲 Apify 토큰이 URL·실패 로그에 노출되지 않는지 검증한다."""
import os
import sys
from unittest.mock import MagicMock, patch

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.yeonsoop import YeonsoopScraper


def _scraper():
    return YeonsoopScraper.__new__(YeonsoopScraper)


def test_apify_token_uses_authorization_header_not_query_string():
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = []

    with patch.dict(os.environ, {'APIFY_TOKEN': 'secret-test-token'}), patch(
        'scrapers.yeonsoop.httpx.post', return_value=response
    ) as post:
        assert _scraper()._fetch_posts() == []

    args, kwargs = post.call_args
    assert 'secret-test-token' not in args[0]
    assert 'params' not in kwargs
    assert kwargs['headers']['Authorization'] == 'Bearer secret-test-token'


def test_apify_402_error_message_does_not_contain_token_or_url():
    request = httpx.Request('POST', 'https://api.apify.com/v2/acts/test')
    failed = httpx.Response(402, request=request)
    response = MagicMock()
    response.raise_for_status.side_effect = httpx.HTTPStatusError(
        'payment required', request=request, response=failed
    )

    with patch.dict(os.environ, {'APIFY_TOKEN': 'secret-test-token'}), patch(
        'scrapers.yeonsoop.httpx.post', return_value=response
    ):
        with pytest.raises(RuntimeError) as exc:
            _scraper()._fetch_posts()

    message = str(exc.value)
    assert message == 'Apify HTTP 402 Payment Required — 사용량/결제 한도 확인 필요'
    assert 'secret-test-token' not in message
    assert 'token=' not in message
