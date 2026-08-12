-- company_admin_stats의 "상세 이미지 있음" 판정이 admin이 등록한 company_image_types만
-- 봐서, 파이낸스라운지처럼 크롤러가 attendee_image_url(참석자 명단)을 채우는 업체는
-- 실제로 이미지가 있어도 9건 전부 "이미지 없음"으로 오판됐다(2026-08-11).
create or replace view public.company_admin_stats as
select
  c.id as company_id,
  coalesce(e.upcoming_events, 0::bigint) as upcoming_events,
  coalesce(e.with_images, 0::bigint) as events_with_images,
  coalesce(e.upcoming_events, 0::bigint) - coalesce(e.with_images, 0::bigint) as events_without_images,
  coalesce(t.image_type_count, 0::bigint) as image_type_count,
  coalesce(t.image_count, 0::bigint) as image_count,
  l.last_success_at,
  l.last_executed_at,
  l.last_status
from companies c
left join (
  select
    ev.company_id,
    count(*) as upcoming_events,
    count(*) filter (
      where ev.attendee_image_url is not null
         or exists (
           select 1
           from company_image_types it
           where it.company_id = ev.company_id
             and coalesce(array_length(it.images, 1), 0) > 0
             and exists (
               select 1
               from unnest(it.match_keywords) kw(kw)
               where btrim(kw.kw) <> ''
                 and position(lower(btrim(kw.kw)) in lower(ev.title)) > 0
             )
         )
    ) as with_images
  from events ev
  where ev.event_date >= now() and ev.is_active
  group by ev.company_id
) e on e.company_id = c.id
left join (
  select
    company_image_types.company_id,
    count(*) as image_type_count,
    coalesce(sum(coalesce(array_length(company_image_types.images, 1), 0)), 0::bigint) as image_count
  from company_image_types
  group by company_image_types.company_id
) t on t.company_id = c.id
left join lateral (
  select
    max(crawl_logs.executed_at) filter (where crawl_logs.status = 'success') as last_success_at,
    max(crawl_logs.executed_at) as last_executed_at,
    (array_agg(crawl_logs.status order by crawl_logs.executed_at desc))[1] as last_status
  from crawl_logs
  where crawl_logs.company_id = c.id
) l on true;
