-- 게시판 글에 유튜브 링크 첨부(2026-08-13, 오너 지시). 재생은 앱 안이 아니라
-- 외부(유튜브 앱/브라우저)에서 — youtube.com/youtu.be 는 이미 아웃링크 허용
-- 목록에 있다(app/lib/security.ts). 피드/상세에서는 썸네일+재생 배지만 붙인다.
alter table public.board_posts
  add column if not exists link_urls text[];

comment on column public.board_posts.link_urls is
  '첨부된 유튜브 링크(최대 3개). 상세화면은 img.youtube.com 썸네일+재생 배지를 보여주고,
   탭하면 외부(유튜브 앱/브라우저)에서 재생한다 — 인앱 재생 아님(2026-08-13 오너 결정).';
