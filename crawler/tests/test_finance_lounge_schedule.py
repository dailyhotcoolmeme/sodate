from datetime import datetime
from unittest.mock import patch

from scrapers.finance_lounge import FinanceLoungeScraper


def test_notion_schedule_accepts_both_orders_and_explicit_minutes():
    lines = [
        '11.14 영등포 14시(20대, 남4/여1)',
        '11.14. 영등포 16시반 (남1/여1)',
        '11.15 삼성 10시(20대)',
        '11.15 삼성 12시45분',
        '11.16 20시 삼성(마감)',
        '11.17 삼성 12시65분',
    ]
    blocks = [dict(text=line, has_img=False, img_src=None) for line in lines]
    with patch('scrapers.base_scraper.get_supabase'), patch(
        'scrapers.finance_lounge.datetime', wraps=datetime
    ) as clock:
        clock.now.return_value = datetime(2026, 11, 8)
        scraper = FinanceLoungeScraper()
        with patch.object(scraper, '_fetch_blocks', return_value=blocks):
            events = scraper.scrape()
    assert [(e.event_date, e.location_region, e.is_closed) for e in events] == [
        (datetime(2026, 11, 14, 14), '영등포', False),
        (datetime(2026, 11, 14, 16, 30), '영등포', False),
        (datetime(2026, 11, 15, 10), '삼성', False),
        (datetime(2026, 11, 15, 12, 45), '삼성', False),
        (datetime(2026, 11, 16, 20), '삼성', True),
    ]
    assert all(e.price_male is None and e.price_female is None for e in events)
