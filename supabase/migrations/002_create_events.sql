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
create index events_external_id_company_idx on public.events(external_id, company_id);

-- source_url 중복 방지 (핵심: 같은 URL은 한번만 저장)
create unique index events_unique_source_url on public.events(source_url);

-- updated_at 자동 갱신
create trigger events_updated_at
  before update on public.events
  for each row execute function public.update_updated_at();
