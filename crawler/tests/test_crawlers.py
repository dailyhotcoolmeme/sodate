"""업체별 스크래퍼 단위 테스트 (네트워크 없이 파싱 로직만 검증)"""
import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ──────────────────────────────────────────────
# LoveMatchingScraper 테스트
# ──────────────────────────────────────────────

class TestLoveMatchingScraper:
    def _make_scraper(self):
        with patch('scrapers.lovematching.BaseScraper.__init__', lambda self, slug: None):
            from scrapers.lovematching import LoveMatchingScraper
            scraper = LoveMatchingScraper.__new__(LoveMatchingScraper)
            scraper.company_slug = 'lovematching'
            scraper.supabase = MagicMock()
            from utils.logger import get_logger
            scraper.logger = get_logger('test-lovematching')
            return scraper

    def test_parse_date_dot_format(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('2026.04.01 19:00')
        assert result == datetime(2026, 4, 1, 19, 0)

    def test_parse_date_hyphen_format(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('2026-04-15 20:00')
        assert result == datetime(2026, 4, 15, 20, 0)

    def test_parse_date_returns_none_on_invalid(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('invalid date')
        assert result is None

    def test_extract_region_gangnam(self):
        scraper = self._make_scraper()
        assert scraper._extract_region('강남역 근처 와인 소개팅') == '강남'

    def test_extract_region_hongdae(self):
        scraper = self._make_scraper()
        assert scraper._extract_region('홍대 카페 소개팅') == '홍대'

    def test_extract_region_fallback(self):
        scraper = self._make_scraper()
        assert scraper._extract_region('알 수 없는 위치') == '기타'

    def test_extract_price_with_comma(self):
        scraper = self._make_scraper()
        assert scraper._extract_price('참가비 35,000원') == 35000

    def test_extract_price_without_comma(self):
        scraper = self._make_scraper()
        assert scraper._extract_price('30000원') == 30000

    def test_extract_price_none(self):
        scraper = self._make_scraper()
        assert scraper._extract_price('') is None

    def test_extract_theme_wine(self):
        scraper = self._make_scraper()
        assert '와인' in scraper._extract_theme('와인 로테이션 소개팅')

    def test_extract_theme_default(self):
        scraper = self._make_scraper()
        assert scraper._extract_theme('일반 소개팅') == ['일반']

    def test_extract_ratio(self):
        scraper = self._make_scraper()
        assert scraper._extract_ratio('8:8 소개팅') == '8:8'

    def test_extract_ratio_none(self):
        scraper = self._make_scraper()
        assert scraper._extract_ratio('소개팅') is None


# ──────────────────────────────────────────────
# YeoninScraper 테스트
# ──────────────────────────────────────────────

class TestYeoninScraper:
    def _make_scraper(self):
        with patch('scrapers.yeonin.BaseScraper.__init__', lambda self, slug: None):
            from scrapers.yeonin import YeoninScraper
            scraper = YeoninScraper.__new__(YeoninScraper)
            scraper.company_slug = 'yeonin'
            scraper.supabase = MagicMock()
            from utils.logger import get_logger
            scraper.logger = get_logger('test-yeonin')
            return scraper

    def test_parse_date_korean_format(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('2026.03.25 19:00')
        assert result is not None
        assert result.day == 25

    def test_extract_price_male(self):
        scraper = self._make_scraper()
        result = scraper._extract_price('남성: 40,000원 / 여성: 35,000원', gender='male')
        assert result == 40000

    def test_extract_price_female(self):
        scraper = self._make_scraper()
        result = scraper._extract_price('남성: 40,000원 / 여성: 35,000원', gender='female')
        assert result == 35000

    def test_extract_seats(self):
        scraper = self._make_scraper()
        assert scraper._extract_seats('잔여 3석') == 3
        assert scraper._extract_seats('2자리 남음') == 2
        assert scraper._extract_seats('마감') is None


# ──────────────────────────────────────────────
# EmotionalOrangeScraper 테스트
# ──────────────────────────────────────────────

class TestEmotionalOrangeScraper:
    def _make_scraper(self):
        with patch('scrapers.emotional_orange.BaseScraper.__init__', lambda self, slug: None):
            from scrapers.emotional_orange import EmotionalOrangeScraper
            scraper = EmotionalOrangeScraper.__new__(EmotionalOrangeScraper)
            scraper.company_slug = 'emotional_orange'
            scraper.supabase = MagicMock()
            from utils.logger import get_logger
            scraper.logger = get_logger('test-emotional-orange')
            return scraper

    def test_parse_date_slash_format(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('3/25 19:00')
        assert result is not None
        assert result.month == 3
        assert result.day == 25
        assert result.hour == 19

    def test_parse_date_iso_format(self):
        scraper = self._make_scraper()
        result = scraper._parse_date('2026-04-10')
        assert result is not None
        assert result.year == 2026

    def test_extract_region_sungsu(self):
        scraper = self._make_scraper()
        assert scraper._extract_region('성수동 카페') == '성수'

    def test_extract_price_by_gender(self):
        scraper = self._make_scraper()
        result = scraper._extract_price_by_gender('남성 45,000원', 'male')
        assert result == 45000


# ──────────────────────────────────────────────
# security.py 테스트
# ──────────────────────────────────────────────

class TestSecurity:
    def test_is_allowed_crawl_url_valid(self):
        from utils.security import is_allowed_crawl_url
        assert is_allowed_crawl_url('https://lovematching.kr/schedule') is True
        assert is_allowed_crawl_url('https://yeonin.co.kr/events') is True

    def test_is_allowed_crawl_url_invalid(self):
        from utils.security import is_allowed_crawl_url
        assert is_allowed_crawl_url('https://evil.com/scrape') is False
        assert is_allowed_crawl_url('https://google.com') is False

    def test_sanitize_text_removes_html(self):
        from utils.security import sanitize_text
        result = sanitize_text('<b>강남 소개팅</b><br/>')
        assert '<b>' not in result
        assert '강남 소개팅' in result

    def test_sanitize_text_truncates(self):
        from utils.security import sanitize_text
        long_text = 'a' * 2000
        result = sanitize_text(long_text, max_length=100)
        assert len(result) <= 104  # 100 + '...'

    def test_sanitize_text_none(self):
        from utils.security import sanitize_text
        assert sanitize_text(None) is None
        assert sanitize_text('') is None

    def test_sanitize_url_javascript(self):
        from utils.security import sanitize_url
        assert sanitize_url('javascript:alert(1)') is None

    def test_sanitize_url_data(self):
        from utils.security import sanitize_url
        assert sanitize_url('data:text/html,<h1>xss</h1>') is None

    def test_sanitize_url_valid(self):
        from utils.security import sanitize_url
        result = sanitize_url('https://lovematching.kr/event/1')
        assert result == 'https://lovematching.kr/event/1'

    def test_sanitize_url_relative(self):
        from utils.security import sanitize_url
        result = sanitize_url('/event/1', 'https://lovematching.kr')
        assert result == 'https://lovematching.kr/event/1'

    def test_contains_pii_phone(self):
        from utils.security import contains_pii
        assert contains_pii('연락처: 010-1234-5678') is True

    def test_contains_pii_email(self):
        from utils.security import contains_pii
        assert contains_pii('문의: admin@example.com') is True

    def test_contains_pii_clean(self):
        from utils.security import contains_pii
        assert contains_pii('강남 와인 소개팅 8:8') is False


# ──────────────────────────────────────────────
# image_extractor.py 테스트
# ──────────────────────────────────────────────

class TestImageExtractor:
    def test_extract_images_from_html(self):
        from bs4 import BeautifulSoup
        from utils.image_extractor import extract_images

        html = '''
        <div>
            <img src="/images/event1.jpg" alt="event1">
            <img src="https://cdn.example.com/img2.png" alt="img2">
        </div>
        '''
        soup = BeautifulSoup(html, 'html.parser')
        result = extract_images(soup, 'https://lovematching.kr')
        assert len(result) == 2
        assert 'https://lovematching.kr/images/event1.jpg' in result

    def test_extract_images_limit(self):
        from bs4 import BeautifulSoup
        from utils.image_extractor import extract_images

        imgs = ''.join(f'<img src="/img{i}.jpg">' for i in range(10))
        soup = BeautifulSoup(f'<div>{imgs}</div>', 'html.parser')
        result = extract_images(soup, 'https://lovematching.kr', limit=3)
        assert len(result) == 3

    def test_extract_og_image(self):
        from bs4 import BeautifulSoup
        from utils.image_extractor import extract_og_image

        html = '<meta property="og:image" content="https://cdn.example.com/og.jpg">'
        soup = BeautifulSoup(html, 'html.parser')
        result = extract_og_image(soup)
        assert result == 'https://cdn.example.com/og.jpg'

    def test_extract_og_image_none(self):
        from bs4 import BeautifulSoup
        from utils.image_extractor import extract_og_image

        soup = BeautifulSoup('<html></html>', 'html.parser')
        assert extract_og_image(soup) is None
