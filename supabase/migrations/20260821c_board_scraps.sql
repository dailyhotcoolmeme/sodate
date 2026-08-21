-- 커뮤니티 글 스크랩(북마크) — 2026-08-21
-- MY 탭 "스크랩한 글"의 저장소. 소유권은 게시판 전체와 동일하게 owner_token(기기
-- 시크릿의 sha256)으로 식별한다. board_votes 와 완전히 같은 (post_id, owner_token)
-- 구조 — 한 기기가 한 글을 한 번만 스크랩.
--
-- ⚠️ 앱은 이 표를 절대 직접 읽지 않는다. owner_token 이 조회에 나가면 같은 기기가
--    스크랩한 글을 전부 묶어낼 수 있어(20260731_board.sql:245 주석과 같은 이유),
--    board Edge Function 이 service_role 로만 접근한다 → anon/authenticated SELECT revoke.
--    글 목록도 Edge Function 이 hash 로 필터링해서 board_posts 만 돌려준다.

create table if not exists public.board_scraps (
  post_id     uuid not null references public.board_posts(id) on delete cascade,
  owner_token text not null,
  created_at  timestamptz not null default now(),
  primary key (post_id, owner_token)
);

-- 내 스크랩 목록(owner_token 로 필터, 최신순) 조회용
create index if not exists idx_board_scraps_owner
  on public.board_scraps (owner_token, created_at desc);

alter table public.board_scraps enable row level security;
-- 읽기 정책을 만들지 않는다 → RLS 로 anon/authenticated 는 아무 행도 못 봄.
-- write 도 정책 없음 → Edge Function(service_role, RLS 우회)만 넣고 지운다.

revoke select on public.board_scraps from anon, authenticated;
