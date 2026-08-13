-- admin_analytics 기간 필터를 한국시간(KST) 달력일 기준으로 수정 (2026-08-13).
--
-- ⚠️ 왜 고치나: DB 타임존이 UTC라 now()도 UTC 기준이다. 예전 코드는
--    `now() - make_interval(days => p_days)` 로 그냥 "지금부터 p_days*24시간 전까지"를
--    긁었다. 그래서 "오늘"(p_days=1)이 한국시간 자정부터가 아니라 "지금부터 24시간 전"
--    롤링 윈도우였다(예: 한국시간 오후에 보면 어제 오후~지금이 "오늘"로 잡힘).
--    한국시간 자정을 기준으로 달력일 단위로 끊도록 바꾼다. p_days=1 → 오늘 00:00(KST)
--    이후, p_days=7 → 오늘 포함 최근 7일(6일 전 00:00 KST 이후), 이런 식.
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
with ev as (
  select * from public.analytics_events
   where created_at >= (
     date_trunc('day', now() at time zone 'Asia/Seoul')
       - (greatest(p_days, 1) - 1) * interval '1 day'
   ) at time zone 'Asia/Seoul'
)
select jsonb_build_object(
  -- 이벤트 종류별 건수(요약 카드·전환 퍼널·전체 행동 분포가 전부 이걸 쓴다)
  'counts', (
    select coalesce(jsonb_object_agg(event_type, cnt), '{}'::jsonb)
      from (select event_type, count(*) cnt from ev group by event_type) x
  ),
  'devices', (select count(distinct device_id) from ev),
  'platforms', (
    select coalesce(jsonb_object_agg(platform, cnt), '{}'::jsonb)
      from (select platform, count(*) cnt from ev
             where platform is not null group by platform) x
  ),
  -- 인기 지역 — 앱은 지역'군' 칩을 쓰면서 region_group 을 보낸다. 예전 화면은 옛 키인
  -- region 만 봐서 사실상 늘 비어 있었다(2026-08-12 확인: 30일간 region=0건,
  -- region_group=141건). 둘 다 세되 없어진 'all'만 뺀다.
  'regions', (
    select coalesce(jsonb_agg(jsonb_build_object('name', reg, 'value', cnt) order by cnt desc), '[]'::jsonb)
      from (select coalesce(properties->>'region_group', properties->>'region') reg, count(*) cnt
              from ev
             where event_type = 'filter_apply'
               and coalesce(properties->>'region_group', properties->>'region') is not null
               and coalesce(properties->>'region_group', properties->>'region') <> 'all'
             group by 1 order by 2 desc limit 8) x
  ),
  -- 인기 나이대 — 예전 '인기 테마' 자리를 대신한다. 테마 필터는 UI에서 이미 사라져
  -- (app/index.tsx handleThemeToggle 이 아무 데서도 안 불림) 영원히 빈 그래프였다.
  -- 반면 age_group 은 계속 쌓이는데 화면에 나오는 곳이 없었다.
  'ages', (
    select coalesce(jsonb_agg(jsonb_build_object('name', ag, 'value', cnt) order by ag), '[]'::jsonb)
      from (select properties->>'age_group' ag, count(*) cnt from ev
             where event_type = 'filter_apply' and properties->>'age_group' is not null
             group by 1) x
  ),
  'sorts', (
    select coalesce(jsonb_agg(jsonb_build_object('name', sb, 'value', cnt) order by cnt desc), '[]'::jsonb)
      from (select properties->>'sort_by' sb, count(*) cnt from ev
             where event_type = 'sort_change' and properties->>'sort_by' is not null
             group by 1) x
  ),
  'companies', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', name, 'view', v, 'apply', a, 'favorite', f) order by v desc), '[]'::jsonb)
      from (
        select coalesce(c.name, left(e.company_id::text, 8)) as name,
               count(*) filter (where e.event_type = 'event_view')          as v,
               count(*) filter (where e.event_type = 'event_apply_click')   as a,
               count(*) filter (where e.event_type = 'event_favorite_add')  as f
          from ev e
          left join public.companies c on c.id = e.company_id
         where e.company_id is not null
         group by 1
      ) y
  )
);
$$;
