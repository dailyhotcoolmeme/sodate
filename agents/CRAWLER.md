# CRAWLER.md — 크롤러 에이전트 지시서

## 역할
각 소개팅 업체 사이트를 자동으로 크롤링하여 이벤트 정보를 Supabase에 저장합니다.
GitHub Actions를 통해 하루 3회 자동 실행됩니다.

## 전제조건
- ARCH 완료 (폴더 구조)
- DB 완료 (events, companies, crawl_logs 테이블)

---

## Step 1. 공통 기반 코드

### `crawler/models/event.py`
```python
from pydantic import BaseModel, HttpUrl, field_validator
from datetime import datetime
from typing import Optional

class EventModel(BaseModel):
    external_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    thumbnail_urls: list[str] = []
    event_date: datetime
    location_region: str
    location_detail: Optional[str] = None
    price_male: Optional[int] = None
    price_female: Optional[int] = None
    gender_ratio: Optional[str] = None
    capacity_male: Optional[int] = None
    capacity_female: Optional[int] = None
    seats_left_male: Optional[int] = None
    seats_left_female: Optional[int] = None
    theme: list[str] = []
    age_range_min: Optional[int] = None
    age_range_max: Optional[int] = None
    format: Optional[str] = None
    source_url: str
    is_closed: bool = False

    @field_validator('thumbnail_urls')
    @classmethod
    def limit_thumbnails(cls, v):
        return v[:5]  # 최대 5개

    @field_validator('location_region')
    @classmethod
    def normalize_region(cls, v):
        # 지역명 표준화
        region_map = {
            '강남구': '강남', '역삼동': '역삼', '선릉': '선릉',
            '마포': '홍대', '홍익': '홍대', '연남': '연남',
            '수원시': '수원', '분당': '분당',
        }
        for key, normalized in region_map.items():
            if key in v:
                return normalized
        return v
```

### `crawler/utils/supabase_client.py`
```python
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수 필요")
    return create_client(url, key)
```

### `crawler/utils/logger.py`
```python
import logging
import sys

def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(
            '%(asctime)s [%(name)s] %(levelname)s: %(message)s'
        ))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
```

### `crawler/scrapers/base_scraper.py`
```python
import time
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from models.event import EventModel
from utils.supabase_client import get_supabase
from utils.logger import get_logger

class BaseScraper(ABC):
    def __init__(self, company_slug: str):
        self.company_slug = company_slug
        self.supabase = get_supabase()
        self.logger = get_logger(company_slug)
        self.company_id: Optional[str] = None

    def get_company_id(self) -> str:
        if self.company_id:
            return self.company_id
        result = self.supabase.table('companies')\
            .select('id')\
            .eq('slug', self.company_slug)\
            .single()\
            .execute()
        self.company_id = result.data['id']
        return self.company_id

    @abstractmethod
    def scrape(self) -> list[EventModel]:
        """업체 사이트에서 이벤트 목록을 스크래핑하여 반환"""
        pass

    def save_events(self, events: list[EventModel]) -> dict:
        """이벤트를 Supabase에 upsert 저장"""
        company_id = self.get_company_id()
        new_count = 0
        updated_count = 0

        for event in events:
            data = event.model_dump()
            data['company_id'] = company_id
            data['crawled_at'] = datetime.utcnow().isoformat()
            # event_date를 ISO string으로 변환
            if isinstance(data['event_date'], datetime):
                data['event_date'] = data['event_date'].isoformat()

            try:
                # source_url 기준으로 upsert (중복 방지)
                result = self.supabase.table('events')\
                    .upsert(data, on_conflict='source_url')\
                    .execute()
                # upsert 결과로 신규/업데이트 구분
                if result.data:
                    new_count += 1
            except Exception as e:
                self.logger.error(f"이벤트 저장 실패: {event.source_url} - {e}")

        return {'new': new_count, 'updated': updated_count}

    def log_result(self, status: str, events_found: int, new: int,
                   updated: int, error: str = None, duration_ms: int = 0):
        """크롤링 결과를 crawl_logs에 기록"""
        self.supabase.table('crawl_logs').insert({
            'company_id': self.get_company_id(),
            'status': status,
            'events_found': events_found,
            'events_new': new,
            'events_updated': updated,
            'error_message': error,
            'duration_ms': duration_ms,
        }).execute()

    def run(self) -> dict:
        """전체 크롤링 실행 (스크래핑 → 저장 → 로그)"""
        start = time.time()
        try:
            self.logger.info(f"[{self.company_slug}] 크롤링 시작")
            events = self.scrape()
            self.logger.info(f"[{self.company_slug}] {len(events)}개 이벤트 발견")

            result = self.save_events(events)
            duration = int((time.time() - start) * 1000)

            self.log_result(
                status='success',
                events_found=len(events),
                new=result['new'],
                updated=result['updated'],
                duration_ms=duration
            )
            self.logger.info(f"[{self.company_slug}] 완료 - 신규: {result['new']}, 업데이트: {result['updated']}")
            return {'status': 'success', **result}

        except Exception as e:
            duration = int((time.time() - start) * 1000)
            self.logger.error(f"[{self.company_slug}] 크롤링 실패: {e}")
            self.log_result(
                status='failed',
                events_found=0,
                new=0,
                updated=0,
                error=str(e),
                duration_ms=duration
            )
            return {'status': 'failed', 'error': str(e)}
```

---

## Step 2. 업체별 스크래퍼

### `crawler/scrapers/lovematching.py`
```python
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from .base_scraper import BaseScraper
from models.event import EventModel

class LoveMatchingScraper(BaseScraper):
    def __init__(self):
        super().__init__('lovematching')
        self.base_url = 'https://lovematching.kr'

    def scrape(self) -> list[EventModel]:
        response = httpx.get(f'{self.base_url}/schedule', timeout=30)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        events = []
        # 실제 HTML 구조에 맞게 셀렉터 수정 필요
        # 아래는 템플릿 - 실제 사이트 분석 후 수정
        for card in soup.select('.event-card, .schedule-item, [class*="schedule"]'):
            try:
                title = card.select_one('[class*="title"], h2, h3')
                date_el = card.select_one('[class*="date"], time')
                price_el = card.select_one('[class*="price"]')
                link_el = card.select_one('a[href]')
                img_el = card.select_one('img')

                if not title or not date_el or not link_el:
                    continue

                source_url = link_el['href']
                if not source_url.startswith('http'):
                    source_url = self.base_url + source_url

                event = EventModel(
                    title=title.get_text(strip=True),
                    event_date=self._parse_date(date_el.get_text(strip=True)),
                    location_region=self._extract_region(title.get_text()),
                    price_male=self._extract_price(price_el.get_text() if price_el else ''),
                    source_url=source_url,
                    thumbnail_urls=[img_el['src']] if img_el else [],
                    theme=self._extract_theme(title.get_text()),
                )
                events.append(event)
            except Exception as e:
                self.logger.warning(f"카드 파싱 실패: {e}")
                continue

        return events

    def _parse_date(self, date_str: str) -> datetime:
        # 날짜 문자열 파싱 (예: '2026.03.25 19:00')
        formats = ['%Y.%m.%d %H:%M', '%Y-%m-%d %H:%M', '%m/%d %H:%M']
        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt)
            except ValueError:
                continue
        raise ValueError(f"날짜 파싱 실패: {date_str}")

    def _extract_region(self, text: str) -> str:
        regions = ['강남', '역삼', '홍대', '신촌', '을지로', '수원', '인천']
        for region in regions:
            if region in text:
                return region
        return '기타'

    def _extract_price(self, text: str) -> int | None:
        import re
        match = re.search(r'(\d{1,3}(?:,\d{3})*|\d+)원', text.replace(' ', ''))
        if match:
            return int(match.group(1).replace(',', ''))
        return None

    def _extract_theme(self, text: str) -> list[str]:
        themes = []
        theme_map = {'와인': '와인', '커피': '커피', '에세이': '에세이',
                     '전시': '전시', '사주': '사주', '보드게임': '보드게임'}
        for keyword, theme in theme_map.items():
            if keyword in text:
                themes.append(theme)
        return themes if themes else ['일반']
```

> **나머지 업체 스크래퍼** (`yeonin.py`, `emotional_orange.py`, `frip.py`, `munto.py`)도
> 동일한 구조(`BaseScraper` 상속)로 작성. 각 업체 사이트의 실제 HTML 구조를
> Playwright로 분석한 후 셀렉터 조정 필요.

---

## Step 3. 메인 실행 파일

### `crawler/main.py`
```python
import asyncio
import sys
from scrapers.lovematching import LoveMatchingScraper
from scrapers.yeonin import YeoninScraper
from scrapers.emotional_orange import EmotionalOrangeScraper
from utils.logger import get_logger

logger = get_logger('main')

SCRAPERS = [
    LoveMatchingScraper,
    YeoninScraper,
    EmotionalOrangeScraper,
    # FripScraper,     # P2
    # MuntoScraper,    # P2
]

def run_all():
    results = []
    for ScraperClass in SCRAPERS:
        scraper = ScraperClass()
        result = scraper.run()
        results.append({
            'company': scraper.company_slug,
            **result
        })

    # 결과 요약
    success = sum(1 for r in results if r['status'] == 'success')
    failed = sum(1 for r in results if r['status'] == 'failed')
    logger.info(f"전체 크롤링 완료 - 성공: {success}, 실패: {failed}")

    if failed > 0:
        logger.warning("일부 업체 크롤링 실패")
        sys.exit(1)  # GitHub Actions에서 실패로 처리

if __name__ == '__main__':
    run_all()
```

---

## Step 4. GitHub Actions 스케줄

### `.github/workflows/crawl.yml`
```yaml
name: Crawl Sodate Events

on:
  schedule:
    - cron: '0 21 * * *'   # 매일 오전 6시 KST (UTC 21시)
    - cron: '0 3 * * *'    # 매일 낮 12시 KST (UTC 3시)
    - cron: '0 9 * * *'    # 매일 오후 6시 KST (UTC 9시)
  workflow_dispatch:         # 수동 실행 가능

jobs:
  crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Cache pip
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('crawler/requirements.txt') }}

      - name: Install dependencies
        run: |
          cd crawler
          pip install -r requirements.txt
          playwright install chromium --with-deps

      - name: Run crawlers
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          cd crawler
          python main.py

      - name: Notify on failure
        if: failure()
        run: |
          echo "크롤링 실패 - 알림 발송 로직 추가 가능"
```

---

## Step 5. 크롤러 테스트

### `crawler/tests/test_base.py`
```python
import pytest
from unittest.mock import MagicMock, patch
from scrapers.base_scraper import BaseScraper
from models.event import EventModel
from datetime import datetime

class MockScraper(BaseScraper):
    def __init__(self):
        self.company_slug = 'test'
        self.company_id = 'test-uuid'
        self.supabase = MagicMock()
        from utils.logger import get_logger
        self.logger = get_logger('test')

    def scrape(self):
        return [EventModel(
            title='테스트 소개팅',
            event_date=datetime(2026, 4, 1, 19, 0),
            location_region='강남',
            source_url='https://example.com/event/1',
        )]

def test_save_events():
    scraper = MockScraper()
    scraper.supabase.table.return_value.upsert.return_value.execute.return_value = MagicMock(data=[{}])
    events = scraper.scrape()
    result = scraper.save_events(events)
    assert result['new'] >= 0

def test_event_model_thumbnail_limit():
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='강남',
        source_url='https://example.com',
        thumbnail_urls=['url1', 'url2', 'url3', 'url4', 'url5', 'url6']  # 6개
    )
    assert len(event.thumbnail_urls) == 5  # 5개로 제한

def test_region_normalization():
    event = EventModel(
        title='test',
        event_date=datetime.now(),
        location_region='강남구',  # 정규화 전
        source_url='https://example.com',
    )
    assert event.location_region == '강남'  # 정규화 후
```

---

## ✅ 완료 기준 (DoD)
- [ ] `python main.py` 실행 시 최소 3개 업체 크롤링 성공
- [ ] Supabase `events` 테이블에 실제 데이터 저장 확인
- [ ] `crawl_logs` 테이블에 실행 결과 기록 확인
- [ ] 같은 URL 재크롤링 시 중복 저장되지 않음 확인
- [ ] `pytest tests/` 전체 통과
- [ ] GitHub Actions `crawl.yml` 수동 실행 성공

## ⛔ 절대 금지
- 로그인 필요 페이지 크롤링 금지
- 1초 이하 간격으로 연속 요청 금지 (요청 간 최소 1~2초 딜레이)
- 개인정보(이름, 연락처 등) 크롤링 절대 금지
- SUPABASE_SERVICE_ROLE_KEY 코드에 하드코딩 금지
