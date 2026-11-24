from datetime import datetime
from utils.loco_poster import agreed_schedule, schedule_lines

NOW = datetime(2026, 11, 23, 9)
TEXT = '11.27(금) 사당점 19:30-22:00\n11.28(토) 수원점 18:30-21:00'


def test_exact_date_venue_time_and_weekday():
    assert agreed_schedule((TEXT, TEXT), NOW) == {
        ('사당', datetime(2026, 11, 27, 19, 30)), ('수원', datetime(2026, 11, 28, 18, 30))}


def test_disagreement_and_conflicting_times_are_rejected():
    assert ('사당', datetime(2026, 11, 27, 19, 30)) not in agreed_schedule(
        (TEXT, TEXT + '\n11.27(금) 사당점 20:30-22:00'), NOW)
    assert agreed_schedule((TEXT, ''), NOW) == set()


def test_wrong_weekday_missing_venue_or_clock_never_filled():
    for text in ('11.27(토) 사당점 19:30-22:00', '11.27(금) 19:30-22:00',
                 '11.27(금) 사당점', '11.27(금) 사당점 7:30-22:00'):
        assert schedule_lines(text, NOW) == set()


def test_loaded_product_uses_only_its_venue_and_available_widget_dates():
    from unittest.mock import MagicMock, patch
    from scrapers.lovecommunity import LovecommunityLoco
    from utils.date_filter import KST
    scraper = LovecommunityLoco.__new__(LovecommunityLoco)
    scraper.logger = MagicMock()
    page = MagicMock()
    page.content.return_value = '<meta property="og:title" content="수원 와인 파티"><div class="fr-view"></div>'
    widget = {(11, 27): {'male': (59000, False), 'female': (39000, False)}}
    schedules = {('수원', datetime(2026, 11, 27, 19, 30)),
                 ('사당', datetime(2026, 11, 27, 20, 30)),
                 ('수원', datetime(2026, 11, 28, 18, 30))}
    clock = MagicMock(wraps=datetime)
    clock.now.return_value = NOW.replace(tzinfo=KST)
    with patch('scrapers.lovecommunity.gender_soldout_loco', return_value=widget), \
         patch('scrapers.lovecommunity.read_roster_schedules', return_value=schedules), \
         patch('scrapers.lovecommunity.datetime', clock):
        _, events = scraper._read_loaded_product(page, '1')
    assert [(e.event_date, e.price_male) for e in events] == [(datetime(2026, 11, 27, 19, 30), 59000)]


def test_roster_heading_spacing_does_not_discard_matching_source_schedules():
    from unittest.mock import MagicMock, patch
    from types import SimpleNamespace
    from bs4 import BeautifulSoup
    from utils.loco_poster import read_roster_schedules
    soup = BeautifulSoup('<div class="fr-view"><img src="https://cdn.imweb.me/upload/roster.jpg"></div>', 'html.parser')
    image = MagicMock(width=1080, height=5400)
    texts = ('직장인 와인 파티 실시간 명단\n' + TEXT,
             '직장인 와인파티 실 시간 명단\n' + TEXT)
    responses = [SimpleNamespace(stdout=t.encode()) for t in texts]
    with patch('utils.loco_poster.shutil.which', return_value='/bin/tesseract'), \
         patch('utils.loco_poster.httpx.get') as get, \
         patch('utils.loco_poster.Image.open', return_value=image), \
         patch('utils.loco_poster.subprocess.run', side_effect=responses):
        get.return_value.content = b'image'
        assert read_roster_schedules(soup, NOW, MagicMock()) == {
            ('사당', datetime(2026, 11, 27, 19, 30)),
            ('수원', datetime(2026, 11, 28, 18, 30))}


def test_auto_layout_recovers_sadang_only_with_two_agreeing_reads():
    suwon = '11.27(금) 수원점 19:30-22:00'
    sadang = '11.27(금) 사당점 19:30-22:00'
    assert agreed_schedule((suwon, suwon + '\n' + sadang, sadang), NOW) == {
        ('수원', datetime(2026, 11, 27, 19, 30)), ('사당', datetime(2026, 11, 27, 19, 30))}
    assert agreed_schedule(('', sadang, ''), NOW) == set()
    assert agreed_schedule((sadang, sadang, sadang.replace('19:30', '20:30')), NOW) == set()
