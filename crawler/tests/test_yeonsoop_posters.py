from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import inspect

import pytest

from scrapers.yeonsoop import YeonsoopScraper, KST
from utils.poster_ocr import PosterOCR
from scrapers.base_scraper import BaseScraper


def source():
    date = (datetime.now(KST) + timedelta(days=7)).replace(hour=13, minute=30, second=0, microsecond=0)
    post = dict(timestamp=datetime.now(timezone.utc).isoformat(), shortCode='poster',
                url='https://www.instagram.com/p/poster/', ownerUsername='yeon_soop_',
                images=['https://scontent.cdninstagram.com/image.jpg'])
    text = f"연숲 로테이션 소개팅\n{date:%m.%d} 토요일 오후 1시 30분\n언주역\n참가비 58,000원"
    return date, post, text


def scraper():
    s = YeonsoopScraper.__new__(YeonsoopScraper)
    s.logger = MagicMock()
    return s


def test_korean_hour_minute_is_not_truncated_to_hour():
    assert YeonsoopScraper._parse_datetime('10.17 토요일 오후 1시 30분', datetime(2026, 9, 29)) == datetime(2026, 10, 17, 13, 30)


def test_confirmed_poster_needs_no_caption_or_other_image():
    date, post, text = source()
    candidate = scraper()._parse_poster_text(text, post)
    assert candidate['event_date'] == date.replace(tzinfo=None)
    assert candidate['location_region'] == '언주역'
    assert candidate['price_male'] == candidate['price_female'] == 58000


@pytest.mark.parametrize('replacement', ['1:30', '1시 30분'])
def test_ambiguous_meridiem_is_never_guessed(replacement):
    _, post, text = source()
    assert scraper()._parse_poster_text(text.replace('오후 1시 30분', replacement), post) is None


def test_different_ocr_dates_do_not_create_a_candidate():
    date, post, text = source()
    later = (date + timedelta(days=1)).strftime('%m.%d')
    reader = SimpleNamespace(read=lambda _: (text, text.replace(date.strftime('%m.%d'), later)))
    assert scraper()._parse_posters(post, reader) == []


def test_price_disagreement_is_unknown_not_a_chosen_price():
    _, post, text = source()
    reader = SimpleNamespace(read=lambda _: (text, text.replace('58,000', '53,000')))
    candidates = scraper()._parse_posters(post, reader)
    assert len(candidates) == 1
    assert candidates[0]['price_male'] is None


def test_price_only_slide_cannot_supply_price_to_another_slide():
    _, post, text = source()
    no_price = text.split('참가비')[0]
    assert scraper()._parse_poster_text(no_price, post)['price_male'] is None
    assert scraper()._parse_poster_text('참가비 58,000원', post) is None


def test_old_poster_is_not_reused_as_next_year_event():
    _, post, text = source()
    post['timestamp'] = (datetime.now(timezone.utc)-timedelta(days=90)).isoformat()
    old = (datetime.now(KST)-timedelta(days=90)).strftime('%m.%d')
    text = text.replace((datetime.now(KST)+timedelta(days=7)).strftime('%m.%d'), old)
    assert scraper()._parse_poster_text(text, post) is None


def test_multiple_dates_or_stations_are_rejected():
    date, post, text = source()
    assert scraper()._parse_poster_text(text+'\n사당역', post) is None
    assert scraper()._parse_poster_text(text+f'\n{date+timedelta(days=1):%m.%d} 오후 1시 30분', post) is None


def test_non_instagram_image_cannot_trigger_an_http_request():
    with patch('utils.poster_ocr.httpx.stream') as request:
        with pytest.raises(ValueError):
            PosterOCR().read('https://127.0.0.1/private')
    request.assert_not_called()


def test_replay_uses_get_only_and_rejects_old_runs():
    response = MagicMock(status_code=200)
    response.json.return_value = {'data': {'finishedAt': (datetime.now(timezone.utc)-timedelta(hours=20)).isoformat(), 'defaultDatasetId':'old'}}
    with patch.dict('os.environ', {'APIFY_TOKEN': 'fake', 'YEONSOOP_REUSE_LAST_RUN': '1'}), patch('scrapers.yeonsoop.httpx.get', return_value=response), patch('scrapers.yeonsoop.httpx.post') as paid:
        with pytest.raises(RuntimeError, match='18시간'):
            scraper()._fetch_posts()
        paid.assert_not_called()


def test_scrape_reuses_existing_url_and_preserves_unconfirmed_fields():
    date, post, text = source()
    s = scraper()
    s._fetch_posts = lambda: [post]
    s.get_company_id = lambda: 'c'
    existing = dict(source_url='https://www.instagram.com/p/original/', event_date=date.isoformat(),
                    title='오너가 확인한 기존 제목', location_region='언주역', event_type='dating',
                    is_closed=True, age_range_min=30, age_range_max=40)
    s._select_all = lambda *a, **kw: [existing]
    with patch('scrapers.yeonsoop.PosterOCR') as reader:
        reader.return_value.read.return_value = (text, text)
        events = s.scrape()
    assert len(events) == 1
    assert events[0].source_url == existing['source_url']
    assert events[0].is_closed is True
    assert events[0].age_range_min == 30
    assert s.DELETE_STALE is False and s.PRESERVE_MISSING_PRICES is True


def test_same_post_price_slide_is_preferred_over_header_without_price():
    _, post, text = source()
    post['images'].append('https://scontent.cdninstagram.com/price.jpg')
    s = scraper()
    s._fetch_posts = lambda: [post]
    s.get_company_id = lambda: 'c'
    s._select_all = lambda *a, **kw: []
    header = text.split('참가비')[0]
    with patch('scrapers.yeonsoop.PosterOCR') as reader:
        reader.return_value.read.side_effect = [(header, header), (text, text)]
        events = s.scrape()
    assert len(events) == 1 and events[0].price_male == 58000


def test_existing_event_update_keeps_verified_guard_at_write_time():
    code = inspect.getsource(BaseScraper.save_events)
    assert ".eq('source_url', event.source_url)\n                            .eq('verified', False)" in code


def owner_row():
    date, _, _ = source()
    return dict(id='owner', verified=True, is_active=True,
                title='오너 확인 일정', event_date=date.isoformat(),
                location_region='언주역', price_male=48000, price_female=48000,
                source_url='https://form.naver.com/response/confirmed')


def profile_response(row, clock='1:30', station='언주역', date_offset=0):
    import html
    date = datetime.fromisoformat(row['event_date']) + timedelta(days=date_offset)
    text = f'(@yeon_soop_) on Instagram: "💚{date.month}/{date.day}(토) {station} {clock}\n신청은 프로필링크"'
    return SimpleNamespace(text=f'<meta name="description" content="{html.escape(text, quote=True)}">',
                           raise_for_status=lambda: None)


def test_profile_only_reconfirms_existing_verified_event_without_writes():
    s = scraper(); row = owner_row()
    s.get_company_id = lambda: 'c'
    s._select_all = MagicMock(return_value=[row])
    with patch('scrapers.yeonsoop.httpx.get', return_value=profile_response(row)):
        events = s._reconfirm_owner_events()
    s._select_all.assert_called_once_with('*', company_id='c', verified=True, is_active=True)
    assert len(events) == 1 and events[0].event_date.hour == 13
    assert events[0].source_url == row['source_url'] and events[0].price_male == 48000


@pytest.mark.parametrize('kwargs', [dict(clock='2:30'), dict(clock='1:30am'),
                                  dict(clock='오전 1:30'), dict(station='사당역'), dict(date_offset=1)])
def test_changed_profile_does_not_reconfirm_owner_schedule(kwargs):
    s = scraper(); row = owner_row()
    s.get_company_id = lambda: 'c'; s._select_all = lambda *a, **kw: [row]
    with patch('scrapers.yeonsoop.httpx.get', return_value=profile_response(row, **kwargs)):
        assert s._reconfirm_owner_events() == []


def test_profile_never_creates_events_without_owner_row():
    s = scraper(); s.get_company_id = lambda: 'c'; s._select_all = lambda *a, **kw: []
    with patch('scrapers.yeonsoop.httpx.get') as request:
        assert s._reconfirm_owner_events() == []
    request.assert_not_called()


def test_provider_error_item_uses_confirmed_profile_instead_of_timestamp_keyerror():
    s = scraper(); row = owner_row()
    s._fetch_posts = lambda: [dict(error='no_items')]
    s._reconfirm_owner_events = lambda: [__import__('models.event', fromlist=['EventModel']).EventModel(**row)]
    assert len(s.scrape()) == 1


def test_provider_error_without_source_confirmation_still_fails():
    s = scraper(); s._fetch_posts = lambda: [dict(error='no_items')]
    s._reconfirm_owner_events = lambda: []
    with pytest.raises(RuntimeError, match='정상 게시물'):
        s.scrape()
