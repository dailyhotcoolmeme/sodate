"""2026-07-25 발견·수정한 버그들의 회귀테스트.

오너 지시("근본대책") 중 하나 — 오늘 나온 버그 상당수가 "예전엔 맞았는데 사이트
물량/포맷이 바뀌면서 조용히 깨진" 케이스였다(문토 213건으로 늘어나며 정규식 갭
노출, 블로그 매칭 충돌 등). 각 케이스를 실제 발견된 입력값으로 고정해둔다.
"""
import sys
import os
from datetime import datetime
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ──────────────────────────────────────────────
# 문토: 나이 파싱(년생 표기, '세' 없이 두자리만) + 지역 폴백
# ──────────────────────────────────────────────

class TestMuntoAgeRegion:
    def test_title_age_born_year_without_se_suffix(self):
        """'❤️86-98❤️'처럼 '세' 없이 두자리 숫자만 있으면(둘 다 55↑/16↓) 년생으로
        해석해야 한다. 예전엔 리터럴 나이로 오인해 범위밖(86~98세) 판정으로 버려졌음."""
        from scrapers.munto import _munto_title_age
        result = _munto_title_age('❤️86-98❤️ ❗️남1❗️7/25(토)3시 문래 와인 소개팅 홍연', 2026)
        assert result == (28, 40)  # 98년생→28세, 86년생→40세(2026년 기준)

    def test_title_age_literal_age_with_se_still_works(self):
        """'세' 붙은 리터럴 나이(예: 37-45세)는 년생 변환 없이 그대로 나이로 읽어야 한다."""
        from scrapers.munto import _munto_title_age
        result = _munto_title_age('37-45세 로테이션 소개팅', 2026)
        assert result == (37, 45)

    def test_extract_region_empty_location_defaults_to_gita_not_seoul(self):
        """location_field가 비어 있으면 '서울'로 추측하지 말고 '기타'(추측 금지 원칙)."""
        from scrapers.munto import _extract_region
        assert _extract_region('아무 지역 키워드도 없는 텍스트', '') == '기타'

    def test_extract_region_uses_location_field_when_no_keyword_match(self):
        """REGION_KW에 없는 지역은 location_field 첫 단어를 그대로 쓴다(추측 아니고 원본값)."""
        from scrapers.munto import _extract_region
        assert _extract_region('아무 텍스트', '천안시 서북구') == '천안시'


# ──────────────────────────────────────────────
# 에모셔널오렌지: 라인별(티키타카/블랙라운지/돌싱) 나이그룹 테이블 분리
# ──────────────────────────────────────────────

class TestEmotionalOrangeAgeLines:
    def _make_scraper(self):
        with patch('scrapers.emotional_orange.BaseScraper.__init__', lambda self, slug: None):
            from scrapers.emotional_orange import EmotionalOrangeScraper
            scraper = EmotionalOrangeScraper.__new__(EmotionalOrangeScraper)
            scraper.company_slug = 'emotional-orange'
            scraper.supabase = MagicMock()
            from utils.logger import get_logger
            scraper.logger = get_logger('test-eo')
            return scraper

    def test_tiki_taka_uses_default_map(self):
        scraper = self._make_scraper()
        m = scraper._age_code_map_for('[용산 한남] 티키타카 로테이션 소개팅')
        assert m['D'] == (32, 37)  # 2026-07-25 오너 스샷으로 확인한 실제값

    def test_blacklounge_uses_own_map(self):
        """블랙라운지는 티키타카와 그룹별 연령이 다르다 — 같은 D도 값이 다름."""
        scraper = self._make_scraper()
        m = scraper._age_code_map_for('블랙라운지 소개팅 D그룹')
        assert m['D'] == (35, 41)
        assert m['D'] != scraper.AGE_CODE_MAP['D']

    def test_dolsing_uses_own_map_with_open_bounds(self):
        """돌싱은 D/E가 '무자녀 돌싱 전용' 한쪽경계만(이하/이상)."""
        scraper = self._make_scraper()
        m = scraper._age_code_map_for('돌싱 티키타카 소개팅')
        assert m['D'] == (None, 37)
        assert m['E'] == (35, None)


# ──────────────────────────────────────────────
# 러브캐스팅: 나이 정규식이 ♂/♀ 유니코드 기호도 잡아야 함(한글 남/여만으론 100% 미스)
# ──────────────────────────────────────────────

class TestLovecastingAgeSymbols:
    def test_age_regex_matches_unicode_gender_symbols(self):
        from scrapers.lovecasting import LovecastingScraper
        text = '♂\xa0\xa035~45세\xa0\xa0| ♀\xa0\xa035~45세\xa0\xa0|'
        m = LovecastingScraper.AGE_RANGE_MALE_RE.search(text)
        assert m is not None
        assert m.groups() == ('35', '45')
        f = LovecastingScraper.AGE_RANGE_FEMALE_RE.search(text)
        assert f is not None
        assert f.groups() == ('35', '45')


# ──────────────────────────────────────────────
# 공용 지역 해석기: region_phrase 최우선 + location_detail의 '[역명] 상호' 추출
# ──────────────────────────────────────────────

class TestFripDedupByPrice:
    """프립 중복제거가 지역+시간만 보면, 강남·홍대처럼 넓은 지역+인기시간대(토 18시 등)에
    서로 다른 업체의 완전히 별개 이벤트가 우연히 겹쳐 하나가 조용히 사라지던 사고
    (2026-07-25, 오너가 프립 42건 '고스트' 이벤트로 발견)."""

    def _ev(self, region, ts, price_m, price_f, age_min=None):
        from datetime import datetime, timezone
        m = MagicMock()
        m.location_region = region
        m.event_date = datetime.fromtimestamp(ts, tz=timezone.utc)
        m.price_male = price_m
        m.price_female = price_f
        m.age_range_min = age_min
        return m

    def test_same_region_time_different_price_both_kept(self):
        """지역+시간은 같아도 가격이 다르면 별개 이벤트 — 둘 다 보존해야 한다."""
        from scrapers.frip import _dedup_events
        ts = 1785574800
        a = self._ev('강남·서초', ts, 69000, 55000)
        b = self._ev('강남·서초', ts, 70000, 60000)
        result = _dedup_events([a, b])
        assert len(result) == 2

    def test_same_region_time_price_merges_prefers_age(self):
        """지역+시간+가격 전부 같으면 진짜 중복(통합상품/지점상품) — 나이 있는 쪽만 남긴다."""
        from scrapers.frip import _dedup_events
        ts = 1785058380
        no_age = self._ev('잠실', ts, 55000, 35000, age_min=None)
        with_age = self._ev('잠실', ts, 55000, 35000, age_min=34)
        result = _dedup_events([no_age, with_age])
        assert len(result) == 1
        assert result[0].age_range_min == 34


class TestFripWeekdayWeekendVenue:
    """프립 '[평일-을지로][주말-역삼]' — 옵션이름엔 장소가 없어(VENUE_KW 분리 대상 아님)
    예전엔 상품 전체가 하나의 areaName(종로·중구)으로 뭉개져 주말 일정도 을지로로 잘못
    나오던 것(2026-07-25 오너 지적). 제목패턴+요일로 그날 실제 장소를 고른다."""

    def test_weekend_uses_weekend_venue(self):
        from scrapers.frip import _weekday_weekend_venue
        title = '[평일-을지로][주말-역삼]💜15대15 로테이션 커피 소개팅😘'
        saturday = datetime(2026, 7, 25, 16, 0)  # 2026-07-25는 토요일
        assert _weekday_weekend_venue(title, saturday) == '역삼'

    def test_weekday_uses_weekday_venue(self):
        from scrapers.frip import _weekday_weekend_venue
        title = '[평일-을지로][주말-역삼]💜15대15 로테이션 커피 소개팅😘'
        thursday = datetime(2026, 7, 30, 19, 30)  # 2026-07-30은 목요일
        assert _weekday_weekend_venue(title, thursday) == '을지로'

    def test_no_pattern_returns_none(self):
        from scrapers.frip import _weekday_weekend_venue
        assert _weekday_weekend_venue('그냥 평범한 소개팅 제목', datetime(2026, 7, 25)) is None


class TestResolveRegionPriority:
    def test_region_phrase_wins_over_everything(self):
        from utils.region import resolve_region
        assert resolve_region(title='제목엔 지역없음', body='본문도 없음',
                               region_phrase='삼성역') == '삼성역'

    def test_location_detail_extracts_place_name_ignoring_shop_name(self):
        """모드파티 케이스: location_detail='강남역 알베르'(역명+상호)에서 역명만 뽑는다."""
        from utils.region import resolve_region
        assert resolve_region(title='제목엔 지역없음',
                               location_detail='강남역 알베르') == '강남역'

    def test_default_gita_when_nothing_found(self):
        from utils.region import resolve_region
        assert resolve_region(title='지역 정보 전혀 없는 제목') == '기타'
