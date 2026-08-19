-- 요일·시간대 필터를 서버에서 거르기 위한 KST 파생 컬럼 (2026-08-19)
--
-- 왜 필요한가: event_date 는 timestamptz 라 요일·시간을 KST 기준으로 뽑으려면 변환이
-- 필요한데, PostgREST 로는 그 변환식을 필터에 못 쓴다. 그래서 앱이 한 페이지(60건)를
-- 받아 클라이언트에서 걸러왔다. 날짜순 목록이라 첫 페이지가 대략 하루치뿐이어서,
-- "월·화"를 고르면 걸러낸 결과가 몇 건 안 나오고 앱이 다음 페이지를 계속 이어 받았다.
--
--   실측(2026-08-19, 활성 1,099건): 평일(월·화) 선택 시 요청 19회 · 937KB · 1.14초를
--   쓰고도 22건밖에 못 모았다.
--
-- 생성 컬럼(stored)으로 미리 계산해두면 인덱스가 걸려 한 번의 요청으로 끝난다.
-- event_date 가 바뀌면 Postgres 가 알아서 다시 계산하므로 크롤러는 건드릴 게 없다.

alter table public.events
  add column if not exists event_dow smallint
    generated always as (
      extract(dow from (event_date at time zone 'Asia/Seoul'))::smallint
    ) stored,
  add column if not exists event_hour smallint
    generated always as (
      extract(hour from (event_date at time zone 'Asia/Seoul'))::smallint
    ) stored;

comment on column public.events.event_dow is
  'KST 기준 요일(0=일 ~ 6=토). app/constants/filters.ts 의 kstDowHour 와 같은 정의. 앱 요일 필터용 생성 컬럼.';
comment on column public.events.event_hour is
  'KST 기준 시(0~23). 앱 시간대 필터(morning<12 / afternoon<17 / evening<21 / night>=21)용 생성 컬럼.';

-- 피드는 항상 is_active + event_date 범위로 좁힌 뒤 요일·시간대를 얹으므로 복합으로 건다.
create index if not exists idx_events_dow_date
  on public.events (event_dow, event_date) where is_active;
create index if not exists idx_events_hour_date
  on public.events (event_hour, event_date) where is_active;
