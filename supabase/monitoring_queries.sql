-- ============================================================
-- 소개팅모아 모니터링 쿼리
-- Supabase 대시보드 → SQL Editor에서 실행
-- ============================================================

-- 쿼리 1: 일별 크롤링 현황 (최근 7일)
select
  date_trunc('day', executed_at) as date,
  c.name as company,
  count(*) as total_runs,
  sum(case when status = 'success' then 1 else 0 end) as successes,
  sum(case when status = 'failed' then 1 else 0 end) as failures,
  sum(events_new) as new_events
from crawl_logs cl
join companies c on cl.company_id = c.id
where executed_at >= now() - interval '7 days'
group by 1, 2
order by 1 desc, 2;

-- 쿼리 2: 앱에 표시될 이벤트 현황
select
  c.name,
  count(*) as total,
  min(e.event_date) as nearest_event
from events e
join companies c on e.company_id = c.id
where e.is_active = true
  and e.is_closed = false
  and e.event_date >= now()
group by c.name
order by c.name;

-- 쿼리 3: 푸시 알림 현황 (최근 30일 활성 토큰)
select
  date_trunc('day', last_seen_at) as date,
  platform,
  count(*) as active_tokens
from push_tokens
where last_seen_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc;

-- 쿼리 4: 크롤링 성공률 (최근 7일)
select
  c.name,
  count(*) as total,
  round(100.0 * sum(case when status = 'success' then 1 else 0 end) / count(*), 1) as success_rate,
  avg(duration_ms) as avg_duration_ms
from crawl_logs cl
join companies c on cl.company_id = c.id
where cl.executed_at >= now() - interval '7 days'
group by c.name
order by success_rate asc;
