# 데이터 스키마 명세서 (DATA_SCHEMA.md)

## 1. Supabase 테이블 구조

### 1.1 `companies` — 소개팅 업체 정보

```sql
create table companies (
  id            uuid default gen_random_uuid() primary key,
  slug          text unique not null,           -- URL용 고유 식별자 (예: lovematching)
  name          text not null,                  -- 업체명 (예: 러브매칭)
  logo_url      text,                           -- 업체 로고 이미지 URL
  base_url      text not null,                  -- 업체 메인 URL
  crawl_url     text not null,                  -- 크롤링 대상 URL (일정 페이지)
  crawl_type    text not null,                  -- 'static' | 'dynamic' | 'api'
  regions       text[] default '{}',            -- 운영 지역 배열
  description   text,                           -- 업체 소개
  instagram_url text,                           -- 인스타그램 URL
  is_active     boolean default true,           -- 크롤링 활성화 여부
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
```

**인덱스:**
```sql
create index companies_slug_idx on companies(slug);
create index companies_is_active_idx on companies(is_active);
```

---

### 1.2 `events` — 로테이션 소개팅 이벤트

```sql
create table events (
  id              uuid default gen_random_uuid() primary key,
  company_id      uuid references companies(id) on delete cascade not null,
  external_id     text,                         -- 업체 사이트 내 고유 ID (중복 방지용)
  title           text not null,                -- 이벤트 제목
  description     text,                         -- 상세 설명
  thumbnail_urls  text[] default '{}',          -- 썸네일 이미지 URL 배열 (최대 5개)
  event_date      timestamptz not null,         -- 이벤트 날짜/시간
  location_region text not null,                -- 지역 대분류 (예: 강남, 홍대, 수원)
  location_detail text,                         -- 상세 위치 (예: 강남구 역삼동)
  price_male      integer,                      -- 남성 참가비 (원)
  price_female    integer,                      -- 여성 참가비 (원)
  gender_ratio    text,                         -- 성비 (예: '6:6', '8:8', '10:10')
  capacity_male   integer,                      -- 남성 정원
  capacity_female integer,                      -- 여성 정원
  seats_left_male   integer,                    -- 남성 잔여석 (크롤링 가능 시)
  seats_left_female integer,                    -- 여성 잔여석 (크롤링 가능 시)
  theme           text[],                       -- 테마 태그 배열 (예: ['와인', '대화형'])
  age_range_min   integer,                      -- 참가 최소 나이
  age_range_max   integer,                      -- 참가 최대 나이
  format          text,                         -- 진행방식 (예: '1:1 로테이션', '2:2 로테이션')
  source_url      text not null,                -- 업체 신청 페이지 아웃링크 URL
  is_closed       boolean default false,        -- 마감 여부
  is_active       boolean default true,         -- 노출 여부
  crawled_at      timestamptz default now(),    -- 마지막 크롤링 시각
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

**인덱스:**
```sql
create index events_company_id_idx on events(company_id);
create index events_event_date_idx on events(event_date);
create index events_location_region_idx on events(location_region);
create index events_is_active_closed_idx on events(is_active, is_closed);
create index events_external_id_company_idx on events(external_id, company_id); -- 중복 방지
```

**중복 방지 제약:**
```sql
create unique index events_unique_source_url on events(source_url);
```

---

### 1.3 `push_tokens` — 유저 푸시 토큰

```sql
create table push_tokens (
  id            uuid default gen_random_uuid() primary key,
  token         text unique not null,           -- Expo Push Token
  platform      text,                           -- 'ios' | 'android'
  created_at    timestamptz default now(),
  last_seen_at  timestamptz default now()
);
```

---

### 1.4 `alert_subscriptions` — 알림 구독 설정

```sql
create table alert_subscriptions (
  id              uuid default gen_random_uuid() primary key,
  push_token_id   uuid references push_tokens(id) on delete cascade not null,
  -- 필터 조건 (null = 전체)
  regions         text[],                       -- 관심 지역 (null이면 전국)
  max_price       integer,                      -- 최대 가격 필터
  themes          text[],                       -- 관심 테마
  company_ids     uuid[],                       -- 특정 업체 팔로우 (null이면 전체)
  notify_new      boolean default true,         -- 새 일정 알림
  notify_deadline boolean default true,         -- 마감 임박 알림 (D-1)
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

**인덱스:**
```sql
create index alert_subs_token_idx on alert_subscriptions(push_token_id);
create index alert_subs_active_idx on alert_subscriptions(is_active);
```

---

### 1.5 `crawl_logs` — 크롤링 실행 로그

```sql
create table crawl_logs (
  id              uuid default gen_random_uuid() primary key,
  company_id      uuid references companies(id) on delete cascade not null,
  status          text not null,                -- 'success' | 'partial' | 'failed'
  events_found    integer default 0,            -- 발견된 이벤트 수
  events_new      integer default 0,            -- 신규 저장된 이벤트 수
  events_updated  integer default 0,            -- 업데이트된 이벤트 수
  error_message   text,                         -- 실패 시 에러 메시지
  duration_ms     integer,                      -- 실행 시간 (ms)
  executed_at     timestamptz default now()
);
```

---

## 2. Cloudflare Queue 구조

### 2.1 Queue 개요

pgmq 대신 **Cloudflare Queue**를 사용합니다.
크롤러(Python, GitHub Actions)가 Cloudflare Queue Producer API로 메시지를 적재하고,
Cloudflare Worker가 Consumer로서 메시지를 소비하여 Expo Push API를 호출합니다.

```
크롤러 (GitHub Actions)
    ↓ HTTP POST
Cloudflare Queue: push-notifications
    ↓ auto-trigger (batch)
Cloudflare Worker: push-worker
    ↓ HTTP POST
Expo Push API → 유저 폰 푸시
```

### 2.2 Queue 설정 (wrangler.toml)

```toml
name = "push-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[queues.producers]]
queue = "push-notifications"
binding = "PUSH_QUEUE"

[[queues.consumers]]
queue = "push-notifications"
max_batch_size = 100
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "push-notifications-dlq"
```

### 2.3 메시지 포맷 (JSON)

```typescript
// 새 이벤트 알림 메시지
interface PushNotificationMessage {
  type: 'new_event' | 'deadline_reminder';
  event_id: string;           // events.id
  event_title: string;
  event_date: string;         // ISO 8601
  location_region: string;
  company_name: string;
  source_url: string;
  target_tokens: string[];    // Expo Push Token 배열
}
```

### 2.4 메시지 적재 예시 (Python 크롤러)

```python
import httpx

def enqueue_push_notification(payload: dict, cf_account_id: str, queue_id: str, api_token: str):
    url = f"https://api.cloudflare.com/client/v4/accounts/{cf_account_id}/queues/{queue_id}/messages"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }
    body = {
        "messages": [
            {"body": payload, "content_type": "json"}
        ]
    }
    httpx.post(url, json=body, headers=headers)
```

### 2.5 Cloudflare Worker Consumer 예시

```typescript
// src/index.ts
export default {
  async queue(batch: MessageBatch<PushNotificationMessage>, env: Env): Promise<void> {
    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

    const notifications = batch.messages.flatMap((msg) =>
      msg.body.target_tokens.map((token) => ({
        to: token,
        title: msg.body.type === 'new_event'
          ? `🎉 새 소개팅 - ${msg.body.location_region}`
          : `⏰ 마감 임박 - ${msg.body.location_region}`,
        body: msg.body.event_title,
        data: { event_id: msg.body.event_id, source_url: msg.body.source_url },
        sound: 'default',
        badge: 1,
      }))
    )

    // 100개씩 배치 발송
    for (let i = 0; i < notifications.length; i += 100) {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notifications.slice(i, i + 100)),
      })
    }

    batch.ackAll()
  },
}
```

### 2.6 환경변수 (GitHub Actions Secrets 추가)

```bash
CF_ACCOUNT_ID=            # Cloudflare Account ID
CF_QUEUE_ID=              # push-notifications Queue ID
CF_API_TOKEN=             # Cloudflare API Token (Queue Write 권한)
```

---

## 3. RLS (Row Level Security) 정책

```sql
-- companies: 전체 공개 읽기, 수정 불가
alter table companies enable row level security;
create policy "companies_public_read"
  on companies for select using (true);

-- events: 활성화된 것만 공개 읽기
alter table events enable row level security;
create policy "events_public_read"
  on events for select using (is_active = true);

-- push_tokens: 본인 토큰만 관리 (서비스 롤로 처리)
alter table push_tokens enable row level security;
create policy "push_tokens_service_only"
  on push_tokens using (false); -- 앱은 service_role 경유

-- alert_subscriptions: 서비스 롤로만
alter table alert_subscriptions enable row level security;
create policy "alert_subs_service_only"
  on alert_subscriptions using (false);

-- crawl_logs: 읽기 전용 공개 (모니터링용)
alter table crawl_logs enable row level security;
create policy "crawl_logs_public_read"
  on crawl_logs for select using (true);
```

---

## 4. Supabase Edge Functions

### 4.1 `process-push-queue` — Queue 워커
- **트리거**: 매 5분마다 Supabase Cron
- **역할**: pgmq에서 메시지 꺼내기 → Expo Push API 발송
- **파일**: `supabase/functions/process-push-queue/index.ts`

### 4.2 `match-subscriptions` — 구독 매칭
- **트리거**: events 테이블 INSERT 이벤트 (DB Webhook)
- **역할**: 새 이벤트 조건에 맞는 구독자 찾기 → push_notifications Queue에 적재
- **파일**: `supabase/functions/match-subscriptions/index.ts`

---

## 5. 데이터 흐름 요약

```
[크롤러 실행]
    ↓
companies 테이블에서 active 업체 목록 조회
    ↓
각 업체 사이트 스크래핑
    ↓
events 테이블 upsert (source_url 기준 중복 방지)
    ↓ (신규 이벤트 INSERT 발생 시)
match-subscriptions Edge Function 트리거
    ↓
alert_subscriptions에서 조건 매칭 토큰 조회
    ↓
push_notifications Queue에 메시지 적재
    ↓ (5분마다)
process-push-queue Edge Function 실행
    ↓
Expo Push API 호출 → 유저 폰으로 푸시 발송
    ↓
crawl_logs에 실행 결과 기록
```

---

## 6. 지역 코드 표준화

```typescript
const REGIONS = [
  '강남', '역삼', '선릉', '삼성',  // 강남구
  '홍대', '신촌', '연남',           // 마포/서대문
  '을지로', '종로', '광화문',        // 도심
  '잠실', '건대', '성수',           // 동부
  '이태원', '한남',                  // 용산
  '수원', '판교', '분당',           // 경기 남부
  '인천',                           // 인천
  '대전',                           // 대전
  '기타'
] as const;
```

---

## 7. 테마 태그 표준화

```typescript
const THEMES = [
  '와인',      // 와인 소개팅
  '커피',      // 커피/카페 소개팅
  '에세이',    // 에세이 읽기/토론
  '전시',      // 미술관/전시회
  '사주',      // 사주 기반 매칭
  '보드게임',  // 보드게임
  '쿠킹',      // 요리 체험
  '일반',      // 기본 대화형
] as const;
```
