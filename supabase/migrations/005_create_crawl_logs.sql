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

create index crawl_logs_company_idx  on public.crawl_logs(company_id);
create index crawl_logs_status_idx   on public.crawl_logs(status);
create index crawl_logs_executed_idx on public.crawl_logs(executed_at desc);
