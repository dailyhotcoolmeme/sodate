-- 게시판 (docs/BOARD_SPEC.md). 애플 4.2.2 재반려 대응으로 만드는 UGC 기능.
-- 익명 소유권은 후기와 동일하게 owner_token(기기 시크릿의 sha256)으로 식별한다.

-- ── 임계치: 코드 수정 없이 바꿀 수 있게 테이블로 둔다(오너 요구) ──
create table if not exists public.board_settings (
  id                     boolean primary key default true check (id),
  hide_post_reports      integer not null default 5,   -- 글 자동 숨김
  hide_image_reports     integer not null default 2,   -- 이미지 자동 가림(초기엔 낮게)
  hide_comment_reports   integer not null default 5,
  hot_upvotes            integer not null default 10,  -- 목록에서 굵게
  cold_downvotes         integer not null default 10,  -- 목록에서 흐리게
  post_cooldown_seconds  integer not null default 30,  -- 도배 방지
  comment_cooldown_seconds integer not null default 10,
  updated_at             timestamptz not null default now()
);
insert into public.board_settings (id) values (true) on conflict (id) do nothing;
comment on table public.board_settings is
  '게시판 임계치. 한 행만 존재. 사용자가 늘면 hide_image_reports 를 5로 올린다.';

-- ── 글 ──
create table if not exists public.board_posts (
  id            uuid primary key default gen_random_uuid(),
  nickname      text not null,
  title         text not null,
  content       text not null,
  image_urls    text[],
  owner_token   text not null,
  upvotes       integer not null default 0,
  downvotes     integer not null default 0,
  comment_count integer not null default 0,
  view_count    integer not null default 0,
  report_count  integer not null default 0,
  image_report_count integer not null default 0,
  is_active     boolean not null default true,   -- false = 숨김(신고 누적/관리자)
  image_hidden  boolean not null default false,  -- 이미지만 가림 + '검수 중' 오버레이
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.board_posts.image_hidden is
  '신고 누적으로 이미지만 가린 상태. 글은 그대로 보이고 이미지 자리에 검수 중 오버레이.';
comment on column public.board_posts.view_count is
  '쌓아두되 화면에서는 감춘다. 나중에 켜면 그때까지 숫자가 그대로 나온다(오너 확정).';

create index if not exists idx_board_posts_list
  on public.board_posts (is_active, created_at desc);

-- ── 댓글 (대댓글은 한 단계까지) ──
create table if not exists public.board_comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.board_posts(id) on delete cascade,
  parent_id    uuid references public.board_comments(id) on delete cascade,
  nickname     text not null,
  content      text not null,
  owner_token  text not null,
  report_count integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_board_comments_post
  on public.board_comments (post_id, created_at);

-- 대댓글의 대댓글 금지 — parent 가 이미 자식이면 거부
create or replace function public.fn_board_comment_depth()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.board_comments
               where id = new.parent_id and parent_id is not null) then
      raise exception '대댓글에는 답글을 달 수 없습니다';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_board_comment_depth on public.board_comments;
create trigger trg_board_comment_depth
  before insert or update on public.board_comments
  for each row execute function public.fn_board_comment_depth();

-- 댓글 수 동기화
create or replace function public.fn_board_comment_count()
returns trigger language plpgsql security definer as $$
declare pid uuid;
begin
  pid := coalesce(new.post_id, old.post_id);
  update public.board_posts p
     set comment_count = (select count(*) from public.board_comments c
                           where c.post_id = pid and c.is_active)
   where p.id = pid;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_board_comment_count on public.board_comments;
create trigger trg_board_comment_count
  after insert or update or delete on public.board_comments
  for each row execute function public.fn_board_comment_count();

-- ── 추천 · 비추 (기기당 글마다 1회, 다시 누르면 취소) ──
create table if not exists public.board_votes (
  post_id     uuid not null references public.board_posts(id) on delete cascade,
  owner_token text not null,
  value       smallint not null check (value in (1, -1)),
  created_at  timestamptz not null default now(),
  primary key (post_id, owner_token)
);

create or replace function public.fn_board_vote_count()
returns trigger language plpgsql security definer as $$
declare pid uuid;
begin
  pid := coalesce(new.post_id, old.post_id);
  update public.board_posts p
     set upvotes   = (select count(*) from public.board_votes v where v.post_id = pid and v.value = 1),
         downvotes = (select count(*) from public.board_votes v where v.post_id = pid and v.value = -1)
   where p.id = pid;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_board_vote_count on public.board_votes;
create trigger trg_board_vote_count
  after insert or update or delete on public.board_votes
  for each row execute function public.fn_board_vote_count();

-- ── 신고 ──
-- target_type: post / comment / image  (image = 글의 첨부 이미지만 신고)
create table if not exists public.board_reports (
  id             uuid primary key default gen_random_uuid(),
  target_type    text not null check (target_type in ('post', 'comment', 'image')),
  target_id      uuid not null,
  reporter_token text not null,
  reason         text,
  created_at     timestamptz not null default now(),
  unique (target_type, target_id, reporter_token)
);

-- 임계치 도달 시 자동 숨김. 후기(fn_review_report_autohide)와 같은 방식이되
-- 숫자는 board_settings 에서 읽어 코드 수정 없이 바꿀 수 있게 한다.
create or replace function public.fn_board_report_autohide()
returns trigger language plpgsql security definer as $$
declare cnt int; s public.board_settings%rowtype;
begin
  select * into s from public.board_settings where id;
  select count(*) into cnt from public.board_reports
   where target_type = new.target_type and target_id = new.target_id;

  if new.target_type = 'post' then
    update public.board_posts
       set report_count = cnt,
           is_active = case when cnt >= s.hide_post_reports then false else is_active end
     where id = new.target_id;

  elsif new.target_type = 'image' then
    update public.board_posts
       set image_report_count = cnt,
           image_hidden = case when cnt >= s.hide_image_reports then true else image_hidden end
     where id = new.target_id;

  elsif new.target_type = 'comment' then
    update public.board_comments
       set report_count = cnt,
           is_active = case when cnt >= s.hide_comment_reports then false else is_active end
     where id = new.target_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_board_report_autohide on public.board_reports;
create trigger trg_board_report_autohide
  after insert on public.board_reports
  for each row execute function public.fn_board_report_autohide();

-- ── 차단된 기기 (애플 1.2 필수 요건) ──
create table if not exists public.board_blocks (
  owner_token text primary key,
  reason      text,
  created_at  timestamptz not null default now()
);
comment on table public.board_blocks is
  '악성 사용자 차단. 애플 1.2가 요구하는 요건이라 없으면 그것만으로 반려된다.';

-- ── RLS: 앱은 읽기만, 쓰기는 Edge Function(service_role)에서만 ──
alter table public.board_posts    enable row level security;
alter table public.board_comments enable row level security;
alter table public.board_votes    enable row level security;
alter table public.board_reports  enable row level security;
alter table public.board_blocks   enable row level security;
alter table public.board_settings enable row level security;

drop policy if exists board_posts_read on public.board_posts;
create policy board_posts_read on public.board_posts
  for select using (is_active);

drop policy if exists board_comments_read on public.board_comments;
create policy board_comments_read on public.board_comments
  for select using (is_active);

-- 투표는 "내가 눌렀는지"를 앱이 알아야 하므로 읽기 허용(토큰으로 조회).
drop policy if exists board_votes_read on public.board_votes;
create policy board_votes_read on public.board_votes
  for select using (true);

-- settings 는 앱이 임계치(굵게/흐리게 기준)를 알아야 하므로 읽기 허용.
drop policy if exists board_settings_read on public.board_settings;
create policy board_settings_read on public.board_settings
  for select using (true);

-- reports / blocks 는 앱에서 읽을 이유가 없다 → 정책 없음(= service_role 전용).
-- 신고는 대상 종류가 여러 개라(post/comment/image) 외래키를 걸 수 없다.
-- 그래서 글·댓글이 지워져도 신고 기록만 남아 테이블이 계속 불어난다.
-- 신고에는 신고자만 있고 작성자 정보가 없어 남겨둬도 쓸 데가 없으므로 같이 지운다.
create or replace function public.fn_board_cleanup_reports()
returns trigger language plpgsql security definer as $$
begin
  if tg_table_name = 'board_posts' then
    delete from public.board_reports
     where (target_type in ('post','image') and target_id = old.id)
        or (target_type = 'comment' and target_id in
            (select id from public.board_comments where post_id = old.id));
  else
    delete from public.board_reports
     where target_type = 'comment' and target_id = old.id;
  end if;
  return old;
end $$;

drop trigger if exists trg_board_posts_cleanup on public.board_posts;
create trigger trg_board_posts_cleanup
  before delete on public.board_posts
  for each row execute function public.fn_board_cleanup_reports();

drop trigger if exists trg_board_comments_cleanup on public.board_comments;
create trigger trg_board_comments_cleanup
  before delete on public.board_comments
  for each row execute function public.fn_board_cleanup_reports();

-- 지금 남아 있는 고아 신고 정리
delete from public.board_reports r
 where (r.target_type in ('post','image')
        and not exists (select 1 from public.board_posts p where p.id = r.target_id))
    or (r.target_type = 'comment'
        and not exists (select 1 from public.board_comments c where c.id = r.target_id));

-- 조회수는 경쟁 없이 올려야 한다(여러 명이 동시에 열면 값이 어긋난다).
create or replace function public.increment_board_view(p_id uuid)
returns void language sql security definer as $$
  update public.board_posts set view_count = view_count + 1 where id = p_id;
$$;
-- owner_token 이 조회에 나가면 같은 기기가 쓴 글을 전부 묶어낼 수 있다.
-- 익명 게시판에서는 이것만으로 신원이 드러난다 → 앱에는 이 열을 주지 않는다.
-- '내 글인지'는 앱이 기기에 저장한 id 목록으로 판단한다(후기와 동일한 방식).
revoke select on public.board_posts    from anon, authenticated;
revoke select on public.board_comments from anon, authenticated;
revoke select on public.board_votes    from anon, authenticated;

grant select (id, nickname, title, content, image_urls, upvotes, downvotes,
              comment_count, view_count, report_count, image_report_count,
              is_active, image_hidden, created_at, updated_at)
  on public.board_posts to anon, authenticated;

grant select (id, post_id, parent_id, nickname, content,
              report_count, is_active, created_at, updated_at)
  on public.board_comments to anon, authenticated;

-- 투표 집계는 board_posts 에 이미 있으므로 앱이 이 표를 직접 읽을 이유가 없다.
drop policy if exists board_votes_read on public.board_votes;
