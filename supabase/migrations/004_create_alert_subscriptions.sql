create table public.alert_subscriptions (
  id              uuid default gen_random_uuid() primary key,
  push_token_id   uuid references public.push_tokens(id) on delete cascade not null,
  regions         text[],
  max_price       integer check (max_price > 0),
  themes          text[],
  company_ids     uuid[],
  notify_new      boolean default true not null,
  notify_deadline boolean default true not null,
  is_active       boolean default true not null,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null
);

create index alert_subs_token_idx  on public.alert_subscriptions(push_token_id);
create index alert_subs_active_idx on public.alert_subscriptions(is_active);

create trigger alert_subs_updated_at
  before update on public.alert_subscriptions
  for each row execute function public.update_updated_at();
