create table public.push_tokens (
  id           uuid default gen_random_uuid() primary key,
  token        text unique not null,
  platform     text check (platform in ('ios', 'android')),
  created_at   timestamptz default now() not null,
  last_seen_at timestamptz default now() not null
);

create index push_tokens_token_idx on public.push_tokens(token);

-- Data API 2026-10-30: no implicit grants; keep app/server access explicit.
alter table public.push_tokens enable row level security;
grant select, insert, update, delete on table public.push_tokens to service_role;
revoke all on table public.push_tokens from anon, authenticated;
