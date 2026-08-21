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

-- ⚠️ 이 테이블은 컬럼별로 명시적 GRANT 가 걸려 있다(테이블 전체 grant 가 아님).
-- 그래서 새 컬럼을 추가하면 그 컬럼에는 권한이 없어, 앱이 select 에 그 컬럼을 넣는 순간
-- "permission denied for table board_posts" 로 조회 전체가 막힌다(2026-08-21 실제로 겪음:
-- content_below 배포 직후 게시글 조회 전면 중단). 기존 content 컬럼과 동일하게 부여한다.
-- write 는 컬럼 권한이 있어도 RLS(row 레벨)가 막아 Edge Function(service_role)만 가능하다.
grant select (content_below) on public.board_posts to anon, authenticated;
