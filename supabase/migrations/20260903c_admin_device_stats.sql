-- admin 설치 기기 수 집계 — 2026-09-03 오너 요청("회원수라고 해야하나, 그걸 만들 수 있을까")
--
-- 로그인이 없는 앱이라 '회원'이 없다. 대신 앱이 실행될 때마다 남기는 기기 고유값
-- (analytics_events.device_id)을 센다. **회원수보다 큰 숫자**다:
--   · 앱을 지웠다 다시 깔면 다른 기기로 잡힌다
--   · 폰+태블릿을 같이 쓰면 두 대로 센다
--   · 개발·심사용 기기도 섞여 있다
-- 그래서 화면에는 '회원수'가 아니라 '설치 기기'로 적는다.
--
-- ⚠️ 왜 함수로 만드나 — admin 대시보드는 30일치 행을 통째로 받아와 브라우저에서
--    Set 으로 세고 있었다. 그런데 PostgREST 는 기본 1,000행에서 끊는다. 30일치가
--    3,940행이라 **기기 수가 실제보다 적게 나오고 있었다**(2026-09-03 확인).
--    집계는 DB 에서 끝내야 행 수와 무관하게 정확하다.
--
-- 날짜 경계는 모두 한국시간이다. UTC 로 자르면 한국 00~09시에 어제 것이 오늘로 잡힌다.

create or replace function public.admin_device_stats()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with d as (
    select device_id, platform, created_at,
           (created_at at time zone 'Asia/Seoul')::date as kst_day
    from public.analytics_events
  ),
  first_seen as (
    select device_id, min(kst_day) as first_day from d group by device_id
  ),
  today as (
    select (now() at time zone 'Asia/Seoul')::date as kd
  )
  select jsonb_build_object(
    'total',     (select count(distinct device_id) from d),
    'd30',       (select count(distinct device_id) from d, today where kst_day > kd - 30),
    'd7',        (select count(distinct device_id) from d, today where kst_day > kd - 7),
    'today',     (select count(distinct device_id) from d, today where kst_day = kd),
    'yesterday', (select count(distinct device_id) from d, today where kst_day = kd - 1),
    'platforms', (
      select coalesce(jsonb_object_agg(platform, c), '{}'::jsonb)
      from (select platform, count(distinct device_id) c from d group by platform) p
    ),
    -- 월별 '신규' 기기 = 그 달에 처음 나타난 기기. 같은 기기가 여러 달에 중복으로 세어지지 않는다.
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'new', c) order by m), '[]'::jsonb)
      from (
        select to_char(first_day, 'YYYY-MM') m, count(*) c
        from first_seen group by 1
      ) t
    )
  );
$$;

comment on function public.admin_device_stats is
  'admin 대시보드용 설치 기기 집계. 회원수가 아니라 기기 수다(재설치·기기 2대는 중복).';

revoke all on function public.admin_device_stats() from public, anon, authenticated;
grant execute on function public.admin_device_stats() to service_role;
