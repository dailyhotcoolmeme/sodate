# QA.md — QA (Quality Assurance) 에이전트 지시서

## 역할
모든 기능 에이전트의 산출물을 독립적으로 검증합니다.
각 에이전트 작업 완료 즉시 병렬로 실행하며, PM에게 결과를 보고합니다.

---

## 검증 영역별 체크리스트

### 1. 크롤러 QA

```python
# crawler/tests/test_crawlers.py

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta

class TestEventModel:
    def test_thumbnail_limit(self):
        """썸네일 최대 5개 제한"""
        from models.event import EventModel
        event = EventModel(
            title='test', event_date=datetime.now(),
            location_region='강남', source_url='https://test.com',
            thumbnail_urls=['url'] * 10
        )
        assert len(event.thumbnail_urls) == 5

    def test_region_normalization(self):
        """지역명 정규화"""
        from models.event import EventModel
        event = EventModel(
            title='test', event_date=datetime.now(),
            location_region='강남구',  # → '강남'으로 정규화
            source_url='https://test.com',
        )
        assert event.location_region == '강남'

    def test_price_positive(self):
        """가격 음수 불가"""
        from models.event import EventModel
        with pytest.raises(ValueError):
            EventModel(
                title='test', event_date=datetime.now(),
                location_region='강남', source_url='https://test.com',
                price_male=-1000
            )

class TestBaseScraper:
    def test_duplicate_prevention(self):
        """같은 source_url 중복 저장 안됨"""
        # upsert on source_url 확인
        pass  # DB 실제 연동 테스트는 통합 테스트에서

    def test_crawl_log_on_success(self):
        """성공 시 crawl_logs에 success 기록"""
        pass

    def test_crawl_log_on_failure(self):
        """실패 시 crawl_logs에 failed 기록"""
        pass

class TestIntegration:
    """실제 Supabase 연동 통합 테스트 (CI에서만)"""

    @pytest.mark.integration
    def test_lovematching_scraper(self):
        """러브매칭 실제 크롤링 테스트"""
        from scrapers.lovematching import LoveMatchingScraper
        scraper = LoveMatchingScraper()
        events = scraper.scrape()
        assert len(events) >= 0  # 크래시 없이 실행

    @pytest.mark.integration
    def test_no_personal_data(self):
        """개인정보 필드 없음 확인"""
        from scrapers.lovematching import LoveMatchingScraper
        scraper = LoveMatchingScraper()
        events = scraper.scrape()
        for event in events:
            event_dict = event.model_dump()
            # 개인정보 필드 없어야 함
            assert 'name' not in event_dict
            assert 'phone' not in event_dict
            assert 'email' not in event_dict
```

---

### 2. 앱 QA

```typescript
// app/__tests__/EventCard.test.tsx

import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import EventCard from '@/components/EventCard'
import * as outlink from '@/lib/outlink'

const mockEvent = {
  id: 'test-id',
  title: '강남 와인 로테이션 소개팅 8:8',
  event_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2일 후
  location_region: '강남',
  price_male: 40000,
  price_female: 35000,
  gender_ratio: '8:8',
  theme: ['와인'],
  thumbnail_urls: ['https://example.com/img.jpg'],
  source_url: 'https://lovematching.kr/event/1',
  companies: { name: '러브매칭', logo_url: null, id: 'c1', slug: 'lovematching' },
  is_active: true,
  is_closed: false,
}

describe('EventCard', () => {
  it('이벤트 정보가 올바르게 렌더링된다', () => {
    const { getByText } = render(<EventCard event={mockEvent as any} />)
    expect(getByText('강남 와인 로테이션 소개팅 8:8')).toBeTruthy()
    expect(getByText('러브매칭')).toBeTruthy()
    expect(getByText('📍 강남')).toBeTruthy()
  })

  it('신청하기 버튼 탭 시 아웃링크가 열린다', async () => {
    const openOutlinkSpy = jest.spyOn(outlink, 'openOutlink').mockResolvedValue()
    const { getByText } = render(<EventCard event={mockEvent as any} />)
    fireEvent.press(getByText('신청하기 →'))
    expect(openOutlinkSpy).toHaveBeenCalledWith('https://lovematching.kr/event/1')
  })

  it('D-2일 때 마감 임박 뱃지가 표시된다', () => {
    const { getByText } = render(<EventCard event={mockEvent as any} />)
    expect(getByText(/D-2/)).toBeTruthy()
  })

  it('마감된 이벤트는 렌더링되지 않아야 한다', () => {
    // useEvents 훅에서 is_closed=true 필터링 확인
    // 컴포넌트 레벨이 아닌 훅 레벨에서 처리
  })
})

// app/__tests__/useEvents.test.ts
describe('useEvents', () => {
  it('필터 변경 시 재조회한다', () => { /* ... */ })
  it('과거 이벤트는 표시되지 않는다', () => { /* ... */ })
  it('최대 100개까지 로드한다', () => { /* ... */ })
})

// app/__tests__/filterStore.test.ts
describe('filterStore', () => {
  it('최근 필터 최대 5개만 저장한다', () => { /* ... */ })
  it('필터 리셋 시 기본값으로 돌아간다', () => { /* ... */ })
})
```

---

### 3. DB QA

```sql
-- supabase/tests/db_test.sql

-- 1. RLS 테스트: anon이 push_tokens에 접근 불가
set role anon;
select * from push_tokens; -- 결과: 0행 (RLS 차단)

-- 2. RLS 테스트: events는 is_active=true만 보임
insert into events (company_id, title, event_date, location_region, source_url, is_active)
values ('...', '비활성 테스트', now(), '강남', 'https://test.com/inactive', false);
set role anon;
select count(*) from events where source_url = 'https://test.com/inactive'; -- 0이어야 함

-- 3. 중복 방지: 같은 source_url 두 번 insert 시 에러
insert into events (..., source_url) values (..., 'https://test.com/dup');
insert into events (..., source_url) values (..., 'https://test.com/dup'); -- unique violation

-- 4. 가격 음수 불가
insert into events (..., price_male) values (..., -1000); -- check constraint violation

-- 5. crawl_type 유효성
insert into companies (..., crawl_type) values (..., 'invalid'); -- check constraint violation
```

---

### 4. 푸시 알림 QA

```typescript
// 푸시 알림 E2E 체크리스트 (수동 테스트)
const pushQAChecklist = [
  '실기기에서 앱 설치 후 알림 권한 요청 표시되는가',
  '권한 수락 시 Expo Push Token 발급되는가',
  'push_tokens 테이블에 토큰 저장되는가',
  '알림 설정 화면에서 조건 저장 시 alert_subscriptions 반영되는가',
  '새 이벤트 INSERT 시 match-subscriptions 함수 실행되는가',
  'Queue에 메시지 적재되는가 (pgmq 확인)',
  '5분 내 process-push-queue 실행되는가',
  '실기기에 푸시 알림 수신되는가',
  '알림 탭 시 올바른 업체 페이지 열리는가',
  'iOS/Android 모두 동작하는가',
]
```

---

## GitHub Actions QA 워크플로우

### `.github/workflows/test.yml` (업데이트)
```yaml
name: Full QA Suite

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  # 크롤러 테스트
  test-crawler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: cd crawler && pip install -r requirements.txt && playwright install chromium
      - run: cd crawler && pytest tests/ -v --tb=short
      - name: Upload coverage
        uses: codecov/codecov-action@v4

  # 앱 타입 체크
  typecheck-app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd app && npm ci
      - run: cd app && npx tsc --noEmit

  # 앱 유닛 테스트
  test-app:
    runs-on: ubuntu-latest
    needs: typecheck-app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd app && npm ci
      - run: cd app && npx jest --coverage

  # 통합 테스트 (실제 Supabase)
  integration-test:
    runs-on: ubuntu-latest
    needs: [test-crawler, test-app]
    if: github.ref == 'refs/heads/main'
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: cd crawler && pip install -r requirements.txt && playwright install chromium
      - run: cd crawler && pytest tests/ -v -m integration
```

---

## ✅ QA 완료 기준 (DoD)
- [ ] 크롤러 단위 테스트 전체 통과
- [ ] 앱 컴포넌트 테스트 전체 통과
- [ ] TypeScript 타입 에러 0개
- [ ] DB 제약조건 테스트 통과 (중복, 음수가격, 잘못된 enum)
- [ ] RLS 우회 불가 확인
- [ ] 아웃링크 동작 확인
- [ ] 푸시 알림 E2E 체크리스트 전 항목 통과
- [ ] GitHub Actions CI 전체 green

## ⛔ 절대 금지
- 테스트 없이 main 브랜치 직접 푸시 금지
- 실패한 테스트 skip 처리 금지
- 통합 테스트를 프로덕션 DB에서 실행 금지
