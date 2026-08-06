-- 작성자 차단(뮤트) 기능이 owner_token(기기 해시)을 목록·상세 조회에 쓰기 시작했는데
-- (2026-08-03, hooks/useBoard.ts), 20260731_board.sql 에서 이 컬럼을 anon/authenticated
-- 에게서 명시적으로 막아둔 게 그대로 남아 있어 목록 조회 자체가 전부 실패했다(피드가
-- 하나도 안 보이는 사고, 같은 날 바로 확인·복구). 차단 기능은 오너가 이 값을 노출하는
-- 방식으로 승인했으므로 이제 이 컬럼도 열어준다.
grant select (owner_token) on public.board_posts    to anon, authenticated;
grant select (owner_token) on public.board_comments to anon, authenticated;
