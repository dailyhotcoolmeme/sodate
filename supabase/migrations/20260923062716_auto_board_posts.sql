-- 자동 커뮤니티 글 대기함.
-- 생성된 글은 이 표에만 쌓이고, admin에서 게시해야 board_posts로 복사되어 앱에 노출된다.
-- 자동 공개는 auto_post_settings.auto_publish_enabled를 명시적으로 켜기 전까지 꺼져 있다.

create table public.auto_board_posts (
  id                uuid primary key default gen_random_uuid(),
  nickname          text not null check (char_length(nickname) between 2 and 12),
  title             text not null check (char_length(title) between 1 and 60),
  content           text not null check (char_length(content) between 1 and 10000),
  avatar_id         text,
  tag_id            uuid references public.board_tags(id) on delete set null,
  source_type       text not null default 'existing_posts'
                    check (source_type in ('existing_posts', 'external_adapted', 'original', 'manual')),
  source_url        text,
  source_title      text,
  status            text not null default 'draft'
                    check (status in ('draft', 'ready', 'scheduled', 'published', 'rejected', 'failed')),
  scheduled_at      timestamptz,
  published_post_id uuid unique references public.board_posts(id) on delete set null,
  generation_model  text,
  generation_notes  text,
  generated_at      timestamptz not null default now(),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index auto_board_posts_queue_idx
  on public.auto_board_posts (status, scheduled_at, created_at desc);
create index auto_board_posts_recent_title_idx
  on public.auto_board_posts (created_at desc, title);

create table public.auto_board_post_settings (
  id                     boolean primary key default true check (id),
  auto_publish_enabled   boolean not null default false,
  posts_per_hour_min     integer not null default 2 check (posts_per_hour_min between 1 and 5),
  posts_per_hour_max     integer not null default 3 check (posts_per_hour_max between 1 and 5),
  generation_batch_size  integer not null default 60 check (generation_batch_size between 1 and 100),
  updated_at             timestamptz not null default now(),
  check (posts_per_hour_min <= posts_per_hour_max)
);
insert into public.auto_board_post_settings (id) values (true) on conflict (id) do nothing;

-- 앱 공개 글에서도 admin이 자동 생성 원본을 바로 찾아 수정·삭제할 수 있게 연결한다.
alter table public.board_posts
  add column if not exists auto_board_post_id uuid unique
  references public.auto_board_posts(id) on delete set null;

alter table public.auto_board_posts enable row level security;
alter table public.auto_board_post_settings enable row level security;

-- 앱(anon/authenticated)은 대기 글과 자동화 설정을 읽을 이유가 없다.
-- admin의 /api/sb 프록시와 생성 작업은 service_role만 사용한다.
revoke all on table public.auto_board_posts from anon, authenticated;
revoke all on table public.auto_board_post_settings from anon, authenticated;

comment on table public.auto_board_posts is
  '자동 생성 커뮤니티 글 대기함. published 전에는 앱에 노출되지 않는다.';
comment on column public.board_posts.auto_board_post_id is
  'admin 자동 글 대기함 원본. null이면 일반 사용자/공지 글.';

-- 대기 글 공개는 두 표를 한 트랜잭션으로 처리한다. 중간 실패로 앱 글만 생기거나
-- 대기 상태만 published가 되는 것을 막는다. service_role 전용이며 앱에서는 호출 못 한다.
create or replace function public.publish_auto_board_post(p_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  draft public.auto_board_posts%rowtype;
  post_id uuid;
begin
  select * into draft
    from public.auto_board_posts
   where id = p_id
   for update;

  if not found then
    raise exception '자동 게시글 초안을 찾을 수 없습니다';
  end if;
  if draft.status = 'published' and draft.published_post_id is not null then
    return draft.published_post_id;
  end if;
  if draft.status = 'rejected' then
    raise exception '반려된 초안은 게시할 수 없습니다';
  end if;

  insert into public.board_posts (
    nickname, title, content, owner_token, avatar_id, tag_id,
    is_active, auto_board_post_id
  ) values (
    draft.nickname, draft.title, draft.content, gen_random_uuid()::text,
    draft.avatar_id, draft.tag_id, true, draft.id
  ) returning id into post_id;

  update public.auto_board_posts
     set status = 'published',
         published_post_id = post_id,
         published_at = now(),
         updated_at = now()
   where id = draft.id;

  return post_id;
end;
$$;

revoke all on function public.publish_auto_board_post(uuid) from public, anon, authenticated;
grant execute on function public.publish_auto_board_post(uuid) to service_role;
