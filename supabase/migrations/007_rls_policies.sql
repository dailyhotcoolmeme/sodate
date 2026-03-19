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
