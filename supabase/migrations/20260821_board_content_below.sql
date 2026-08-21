-- 게시글 첨부 아래에 이어 쓰는 본문(2026-08-21 오너 지시).
--
-- 기존: content(본문) 하나 → 화면에서 항상 [본문 → 첨부] 순서로 고정.
-- 추가: content_below → 첨부(사진·GIF·유튜브) 아래에 이어지는 글.
--   글쓰기에서 첨부가 하나라도 있을 때만 아랫글 입력칸이 나타나고,
--   상세 화면은 [윗글(content) → 첨부 → 아랫글(content_below)] 로 렌더한다.
--
-- nullable — 아랫글이 없는 글(대부분)은 NULL 이라 기존 글과 완전히 동일하게 동작한다.
-- 리치 에디터(웹뷰) 없이 입력칸 하나만 더 두는 방식이라 가볍다.

alter table public.board_posts
  add column if not exists content_below text;

comment on column public.board_posts.content_below is
  '첨부(사진/유튜브) 아래에 이어 쓰는 본문. 첨부가 있는 글에서만 입력 가능. NULL이면 없음.';
