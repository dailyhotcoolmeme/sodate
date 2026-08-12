-- admin 데이터 분석 집계 (2026-08-12).
--
-- ⚠️ 왜 만들었나: admin/src/pages/Analytics.tsx 가 analytics_events 를 통째로 읽어
--    브라우저에서 집계했는데, PostgREST 가 한 번에 1000행만 돌려준다. 최근 30일이
--    9,313건이라 실제로는 1000건(그것도 정렬 없이 임의로 잘린 1000건)만 보고
--    "앱 실행/조회/신청/고유기기/전환율/업체별 성과"를 전부 계산하고 있었다.
--    화면의 모든 숫자가 틀렸고, 이벤트가 쌓일수록 더 틀어진다.
--    행을 다 끌어오는 대신 DB에서 집계해 한 덩어리로 내려준다.
create or replace function public.admin_analytics(p_days int default 30)
returns jsonb
language sql
security definer
set search_path = public
as $$
with ev as (
  select * from public.analytics_events
   where created_at >= now() - make_interval(days => greatest(p_days, 1))
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

-- admin 은 service_role 로 프록시되어 호출한다. 앱(anon)이 부를 일은 없다.
revoke all on function public.admin_analytics(int) from public, anon, authenticated;
grant execute on function public.admin_analytics(int) to service_role;

-- 기간 필터가 매번 전체를 훑지 않도록
create index if not exists idx_analytics_events_created_at
  on public.analytics_events (created_at desc);
