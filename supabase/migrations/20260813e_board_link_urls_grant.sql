-- 긴급 수정(2026-08-13): board_posts는 컬럼 단위 GRANT를 쓰는데(20260731_board.sql),
-- link_urls 컬럼을 추가하면서 이 grant에 넣는 걸 빠뜨렸다. anon/authenticated가
-- link_urls 컬럼 접근 권한이 없는 채로 앱이 그 컬럼을 select에 넣어 요청하니
-- PostgREST가 select 전체를 거부해 게시판 목록이 통째로 안 보였다.
grant select (link_urls) on public.board_posts to anon, authenticated;
