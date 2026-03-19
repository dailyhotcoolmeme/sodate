create table public.push_tokens (
  id           uuid default gen_random_uuid() primary key,
  token        text unique not null,
  platform     text check (platform in ('ios', 'android')),
  created_at   timestamptz default now() not null,
  last_seen_at timestamptz default now() not null
);

create index push_tokens_token_idx on public.push_tokens(token);
