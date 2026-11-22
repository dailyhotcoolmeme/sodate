"""로꼬 날짜 전용 옵션에서 시작 시간을 추정하지 않는 회귀 테스트."""
import os
import sys
from datetime import datetime
from unittest.mock import MagicMock, patch

from bs4 import BeautifulSoup
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrapers.lovecommunity import LovecommunityLoco
from utils.date_filter import KST


def parse(text, widget=None):
    scraper = LovecommunityLoco.__new__(LovecommunityLoco)
    scraper.logger = MagicMock()
    soup = BeautifulSoup('<meta property="og:title" content="수원 소개팅"><p>' + text + '</p>', 'html.parser')
    clock = MagicMock(wraps=datetime)
    clock.now.side_effect = lambda tz=None: datetime(2026, 11, 22, 8, tzinfo=KST).astimezone(tz) if tz else datetime(2026, 11, 21, 23)
    with patch('scrapers.lovecommunity.datetime', clock):
        return scraper._parse_product_page(soup, '1', widget)


def test_date_only_body_and_widget_never_invent_start_time():
    assert parse('11월 27일(금)', {(11, 27): {'male': (48000, False)}}) == []


def test_explicit_time_is_retained_without_weekday_override():
    events = parse('11월 27일(금) 20:15')
    assert len(events) == 1
    assert events[0].event_date == datetime(2026, 11, 27, 20, 15)


def test_ambiguous_hour_is_not_replaced_with_evening_default():
    assert parse('11월 27일(금) 7:30') == []


def test_korean_morning_does_not_treat_yesterday_as_today():
    events = parse('11월 21일(토) 19:00')
    assert all(e.event_date.date() != datetime(2026, 11, 21).date() for e in events)


def test_incomplete_empty_collection_cannot_delete_future_or_verified_rows():
    scraper = LovecommunityLoco.__new__(LovecommunityLoco)
    scraper.company_slug = 'lovecommunity-loco'
    scraper.logger = MagicMock()
    scraper.supabase = MagicMock()
    scraper.get_company_id = MagicMock(return_value='company-id')
    scraper._load_type_hashtags = MagicMock(return_value=[])
    scraper._select_all = MagicMock(return_value=[])
    scraper.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.lt.return_value.execute.return_value.data = []
    scraper.supabase.table.return_value.delete.return_value.eq.return_value.eq.return_value.lt.return_value.execute.return_value.data = []
    result = scraper.save_events([])
    table = scraper.supabase.table.return_value
    table.upsert.assert_not_called()
    table.update.assert_not_called()
    # 유일한 삭제 경로는 기존 지난 일정 정리이며 미래/verified 행을 포함하지 않는다
    table.delete.assert_called_once_with()
    table.delete.return_value.eq.assert_called_once_with('company_id', 'company-id')
    filtered = table.delete.return_value.eq.return_value
    filtered.eq.assert_called_once_with('verified', False)
    assert filtered.eq.return_value.lt.call_args.args[0] == 'event_date'
    assert result['new'] == result['updated'] == 0
