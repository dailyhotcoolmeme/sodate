from datetime import datetime

from scrapers.yeonsoop import YeonsoopScraper


def test_pm_time_with_minutes_is_converted_to_24_hour_time():
    parsed = YeonsoopScraper._parse_datetime(
        '10/3(토) 오후 2:30시', datetime(2026, 9, 30)
    )

    assert parsed == datetime(2026, 10, 3, 14, 30)


def test_pm_noon_with_minutes_stays_noon():
    parsed = YeonsoopScraper._parse_datetime(
        '10/10(토) 오후 12:30시', datetime(2026, 9, 30)
    )

    assert parsed == datetime(2026, 10, 10, 12, 30)


def test_plain_24_hour_time_still_works():
    parsed = YeonsoopScraper._parse_datetime(
        '10월 3일(토) 19:30', datetime(2026, 9, 30)
    )

    assert parsed == datetime(2026, 10, 3, 19, 30)
