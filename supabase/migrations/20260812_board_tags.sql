-- 게시판 말머리(태그). 종류를 코드에 박아두지 않고 admin 에서 등록·수정하게 한다
-- (2026-08-12 오너 지시). 라벨은 admin이 입력한 문자열([말머리1] 처럼 대괄호까지
-- 포함해서 스스로 정해 넣는다) 그대로 목록·글쓰기에 노출한다 — 여기서 가공하지 않는다.
create table if not exists public.board_tags (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,   -- false = 글쓰기 선택지에서만 빠짐(과거 글의 말머리는 유지)
  created_at timestamptz not null default now()
);
create index if not exists idx_board_tags_active_order
  on public.board_tags (is_active, sort_order);
comment on column public.board_tags.is_active is
  '더 이상 쓰지 않는 말머리를 완전히 지우면 이미 그 말머리로 쓴 글이 고아가 된다.
   그래서 삭제 대신 비활성화 — 글쓰기 선택지에는 안 보이지만 이미 붙은 글에는 그대로 남는다.';

alter table public.board_posts
  add column if not exists tag_id uuid references public.board_tags(id) on delete set null;
create index if not exists idx_board_posts_tag on public.board_posts (tag_id);

alter table public.board_tags enable row level security;
drop policy if exists board_tags_read on public.board_tags;
create policy board_tags_read on public.board_tags for select using (true);

-- 앱은 읽기만(글 목록·글쓰기 선택지). 등록·수정·삭제는 admin이 service_role로 한다
-- (board_settings 와 같은 방식 — 별도 쓰기 정책 없음 = anon/authenticated 는 쓰기 불가).
grant select on public.board_tags to anon, authenticated;
grant select (tag_id) on public.board_posts to anon, authenticated;
