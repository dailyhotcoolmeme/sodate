# DB.md — 데이터베이스 에이전트 지시서

## 역할
Supabase 데이터베이스의 모든 것을 담당합니다.
테이블 생성, RLS 정책, pgmq Queue, Edge Functions, 타입 생성까지 모두 처리합니다.

## 전제조건
- `docs/DATA_SCHEMA.md` 반드시 먼저 읽을 것
- Supabase 프로젝트가 이미 생성되어 있을 것

---

## Step 1. 마이그레이션 파일 작성

아래 파일들을 `supabase/migrations/` 에 순서대로 작성하세요.

### `001_create_companies.sql`
```sql
-- 소개팅 업체 테이블
create table public.companies (
  id            uuid default gen_random_uuid() primary key,
  slug          text unique not null,
  name          text not null,
  logo_url      text,
  base_url      text not null,
  crawl_url     text not null,
  crawl_type    text not null check (crawl_type in ('static', 'dynamic', 'api')),
  regions       text[] default '{}',
  description   text,
  instagram_url text,
  is_active     boolean default true not null,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index companies_slug_idx on public.companies(slug);
create index companies_is_active_idx on public.companies(is_active);

-- 업데이트 시 updated_at 자동 갱신 트리거
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at();

-- 초기 업체 데이터 삽입
insert into public.companies (slug, name, base_url, crawl_url, crawl_type, regions, description) values
('lovematching', '러브매칭', 'https://lovematching.kr', 'https://lovematching.kr/schedule', 'static', array['강남','역삼','홍대','신촌','을지로'], '2022년부터 운영, JTBC/CBS 출연 이력'),
('yeonin', '연인어때', 'https://yeonin.co.kr', 'https://yeonin.co.kr/schedule', 'static', array['강남','수원','대전','천안'], '서류/사진 검증 시스템 운영'),
('emotional-orange', '에모셔널오렌지', 'https://emotional0ranges.com', 'https://emotional0ranges.com/shop', 'static', array['강남','수원','한남'], '최대 12명 소개팅');
```

### `002_create_events.sql`
```sql
-- 이벤트 테이블
create table public.events (
  id                uuid default gen_random_uuid() primary key,
  company_id        uuid references public.companies(id) on delete cascade not null,
  external_id       text,
  title             text not null,
  description       text,
  thumbnail_urls    text[] default '{}' not null,
  event_date        timestamptz not null,
  location_region   text not null,
  location_detail   text,
  price_male        integer check (price_male >= 0),
  price_female      integer check (price_female >= 0),
  gender_ratio      text,
  capacity_male     integer check (capacity_male > 0),
  capacity_female   integer check (capacity_female > 0),
  seats_left_male   integer check (seats_left_male >= 0),
  seats_left_female integer check (seats_left_female >= 0),
  theme             text[] default '{}',
  age_range_min     integer check (age_range_min >= 18),
  age_range_max     integer check (age_range_max <= 60),
  format            text,
  source_url        text not null,
  is_closed         boolean default false not null,
  is_active         boolean default true not null,
  crawled_at        timestamptz default now() not null,
  created_at        timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

-- 인덱스
create index events_company_id_idx      on public.events(company_id);
create index events_event_date_idx      on public.events(event_date);
create index events_location_region_idx on public.events(location_region);
create index events_active_closed_idx   on public.events(is_active, is_closed);
create index events_theme_gin_idx       on public.events using gin(theme);

-- source_url 중복 방지 (핵심: 같은 URL은 한번만 저장)
create unique index events_unique_source_url on public.events(source_url);

-- updated_at 자동 갱신
create trigger events_updated_at
  before update on public.events
  for each row execute function public.update_updated_at();
```

### `003_create_push_tokens.sql`
```sql
create table public.push_tokens (
  id           uuid default gen_random_uuid() primary key,
  token        text unique not null,
  platform     text check (platform in ('ios', 'android')),
  created_at   timestamptz default now() not null,
  last_seen_at timestamptz default now() not null
);

create index push_tokens_token_idx on public.push_tokens(token);
```

### `004_create_alert_subscriptions.sql`
```sql
create table public.alert_subscriptions (
  id              uuid default gen_random_uuid() primary key,
  push_token_id   uuid references public.push_tokens(id) on delete cascade not null,
  regions         text[],
  max_price       integer check (max_price > 0),
  themes          text[],
  company_ids     uuid[],
  notify_new      boolean default true not null,
  notify_deadline boolean default true not null,
  is_active       boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index alert_subs_token_idx  on public.alert_subscriptions(push_token_id);
create index alert_subs_active_idx on public.alert_subscriptions(is_active);

create trigger alert_subs_updated_at
  before update on public.alert_subscriptions
  for each row execute function public.update_updated_at();
```

### `005_create_crawl_logs.sql`
```sql
create table public.crawl_logs (
  id             uuid default gen_random_uuid() primary key,
  company_id     uuid references public.companies(id) on delete cascade not null,
  status         text not null check (status in ('success', 'partial', 'failed')),
  events_found   integer default 0 not null,
  events_new     integer default 0 not null,
  events_updated integer default 0 not null,
  error_message  text,
  duration_ms    integer,
  executed_at    timestamptz default now() not null
);

create index crawl_logs_company_idx on public.crawl_logs(company_id);
create index crawl_logs_status_idx  on public.crawl_logs(status);
create index crawl_logs_executed_idx on public.crawl_logs(executed_at desc);
```

### `006_create_pgmq_queue.sql`
```sql
-- pgmq 확장 활성화 (Supabase 대시보드에서도 가능)
create extension if not exists pgmq;

-- 푸시 알림 Queue 생성
select pgmq.create('push_notifications');
```

### `007_rls_policies.sql`
```sql
-- companies: 전체 공개 읽기
alter table public.companies enable row level security;
create policy "companies_public_read"
  on public.companies for select to anon, authenticated
  using (true);

-- events: 활성화된 것만 공개 읽기
alter table public.events enable row level security;
create policy "events_public_read"
  on public.events for select to anon, authenticated
  using (is_active = true);

-- push_tokens: service_role만 접근
alter table public.push_tokens enable row level security;
create policy "push_tokens_service_only"
  on public.push_tokens
  using (false);  -- 앱은 service_role 경유

-- alert_subscriptions: service_role만 접근
alter table public.alert_subscriptions enable row level security;
create policy "alert_subs_service_only"
  on public.alert_subscriptions
  using (false);

-- crawl_logs: 공개 읽기 (모니터링용)
alter table public.crawl_logs enable row level security;
create policy "crawl_logs_public_read"
  on public.crawl_logs for select to anon, authenticated
  using (true);
```

---

## Step 2. Supabase Edge Functions 작성

### `supabase/functions/match-subscriptions/index.ts`
새 이벤트가 INSERT될 때 조건에 맞는 구독자 찾아서 Queue에 적재

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { record } = await req.json()  // DB Webhook payload
  const event = record

  // 이벤트 조건에 맞는 활성 구독자 조회
  const { data: subscriptions } = await supabase
    .from('alert_subscriptions')
    .select('*, push_tokens(token)')
    .eq('is_active', true)
    .eq('notify_new', true)

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
  }

  // 조건 필터링
  const matchedTokens: string[] = []
  for (const sub of subscriptions) {
    const token = sub.push_tokens?.token
    if (!token) continue

    // 지역 조건
    if (sub.regions && sub.regions.length > 0) {
      if (!sub.regions.includes(event.location_region)) continue
    }

    // 가격 조건
    if (sub.max_price) {
      const price = event.price_male || event.price_female || 0
      if (price > sub.max_price) continue
    }

    // 테마 조건
    if (sub.themes && sub.themes.length > 0) {
      const hasTheme = event.theme?.some((t: string) => sub.themes.includes(t))
      if (!hasTheme) continue
    }

    // 특정 업체 조건
    if (sub.company_ids && sub.company_ids.length > 0) {
      if (!sub.company_ids.includes(event.company_id)) continue
    }

    matchedTokens.push(token)
  }

  if (matchedTokens.length === 0) {
    return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
  }

  // 회사명 조회
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', event.company_id)
    .single()

  // Queue에 적재 (배치: 최대 500개씩)
  const BATCH_SIZE = 500
  let queued = 0
  for (let i = 0; i < matchedTokens.length; i += BATCH_SIZE) {
    const batch = matchedTokens.slice(i, i + BATCH_SIZE)
    await supabase.rpc('pgmq_send', {
      queue_name: 'push_notifications',
      msg: {
        type: 'new_event',
        event_id: event.id,
        event_title: event.title,
        event_date: event.event_date,
        location_region: event.location_region,
        company_name: company?.name || '',
        source_url: event.source_url,
        target_tokens: batch,
      }
    })
    queued += batch.length
  }

  return new Response(JSON.stringify({ queued }), { status: 200 })
})
```

### `supabase/functions/process-push-queue/index.ts`
5분마다 실행 - Queue에서 메시지 꺼내 Expo Push API 발송

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Queue에서 메시지 읽기 (최대 10개씩)
  const { data: messages } = await supabase.rpc('pgmq_read', {
    queue_name: 'push_notifications',
    vt: 30,   // 30초 visibility timeout
    qty: 10
  })

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  let totalSent = 0
  const processedMsgIds: number[] = []

  for (const msg of messages) {
    const payload = msg.message
    const tokens: string[] = payload.target_tokens || []

    // Expo Push API 형식으로 변환
    const notifications = tokens.map((token: string) => ({
      to: token,
      title: payload.type === 'new_event'
        ? `🎉 새 소개팅 - ${payload.location_region}`
        : `⏰ 마감 임박 - ${payload.location_region}`,
      body: payload.event_title,
      data: {
        event_id: payload.event_id,
        source_url: payload.source_url,
      },
      sound: 'default',
      badge: 1,
    }))

    // Expo Push API 호출 (100개씩 배치)
    const BATCH = 100
    for (let i = 0; i < notifications.length; i += BATCH) {
      const batch = notifications.slice(i, i + BATCH)
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (res.ok) totalSent += batch.length
    }

    processedMsgIds.push(msg.msg_id)
  }

  // 처리 완료된 메시지 Queue에서 삭제
  for (const msgId of processedMsgIds) {
    await supabase.rpc('pgmq_delete', {
      queue_name: 'push_notifications',
      msg_id: msgId
    })
  }

  return new Response(JSON.stringify({ sent: totalSent }), { status: 200 })
})
```

---

## Step 3. DB Webhook 설정 (Supabase 대시보드)

Supabase 대시보드 → Database → Webhooks:
```
이름: on_event_insert
테이블: events
이벤트: INSERT
URL: {SUPABASE_URL}/functions/v1/match-subscriptions
```

## Step 4. Supabase Cron 설정

```sql
-- 5분마다 Queue 워커 실행
select cron.schedule(
  'process-push-queue',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/process-push-queue',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
  );
  $$
);
```

## Step 5. 타입 자동생성
```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > app/types/database.types.ts
```

---

## ✅ 완료 기준 (DoD)
- [ ] 7개 마이그레이션 파일 생성 및 Supabase에 적용 완료
- [ ] `select count(*) from companies` → 3건 이상 확인
- [ ] `select count(*) from events` → 테이블 존재 확인
- [ ] pgmq Queue 생성 확인 (`select * from pgmq.list_queues()`)
- [ ] RLS 정책 확인 - anon 키로 push_tokens 접근 불가
- [ ] 2개 Edge Function 배포 완료
- [ ] `database.types.ts` 생성 완료

## ⛔ 절대 금지
- service_role_key를 anon_key로 착각하여 앱에 사용 금지
- RLS 비활성화 상태로 배포 금지
- 마이그레이션 파일 순서 변경 금지
