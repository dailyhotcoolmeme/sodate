-- analytics_events: 앱 사용자 행동 추적 테이블
create table public.analytics_events (
  id          uuid default gen_random_uuid() primary key,

  -- 이벤트 타입
  event_type  text not null,
  -- app_open | screen_view
  -- event_impression | event_view | event_apply_click
  -- event_favorite_add | event_favorite_remove
  -- alert_subscribe | alert_unsubscribe
  -- filter_apply | filter_reset | sort_change
  -- company_view | review_view | review_click

  -- 연관 데이터 (nullable)
  event_id    uuid references public.events(id) on delete set null,
  company_id  uuid references public.companies(id) on delete set null,

  -- 익명 사용자 식별
  device_id   text not null,   -- 앱 설치당 UUID (재설치 시 초기화)
  session_id  text not null,   -- 앱 실행당 UUID (앱 재시작마다 갱신)

  -- 환경
  platform    text,            -- 'ios' | 'android'
  app_version text,

  -- 이벤트별 추가 속성 (자유 형식)
  properties  jsonb default '{}',

  created_at  timestamptz default now()
);

-- 조회 성능용 인덱스
create index analytics_event_type_idx  on public.analytics_events(event_type);
create index analytics_company_id_idx  on public.analytics_events(company_id);
create index analytics_event_id_idx    on public.analytics_events(event_id);
create index analytics_created_at_idx  on public.analytics_events(created_at desc);
create index analytics_device_id_idx   on public.analytics_events(device_id);
create index analytics_platform_idx    on public.analytics_events(platform);

-- RLS: anon은 INSERT만, 읽기는 service_role만
alter table public.analytics_events enable row level security;

create policy "analytics_anon_insert"
  on public.analytics_events
  for insert
  to anon
  with check (true);

-- events/companies 테이블에 수익화용 필드 추가
alter table public.events
  add column if not exists is_featured     boolean default false,
  add column if not exists featured_until  timestamptz,
  add column if not exists display_order   integer default 0;

alter table public.companies
  add column if not exists plan            text default 'free',
  add column if not exists plan_expires_at timestamptz;

create index events_featured_idx on public.events(is_featured, featured_until);
create index events_display_order_idx on public.events(display_order);
