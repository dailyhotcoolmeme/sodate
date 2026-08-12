-- 비밀 댓글 (2026-08-12 오너 지시).
-- [동행구함] 류 글에서 연락처·인스타 계정을 주고받아야 하는데, 일반 댓글로 쓰면
-- 모두에게 노출된다. 그래서 "비밀" 체크한 댓글은 아래 세 사람만 내용을 볼 수 있다.
--   1) 그 댓글을 쓴 본인
--   2) 게시글 작성자
--   3) (대댓글인 경우) 원 댓글을 쓴 사람
-- 3번이 없으면 글쓴이가 답을 줘도 정작 처음 물어본 사람이 못 본다(오너 승인).
--
-- ⚠️ 화면에서만 가리는 방식은 보안이 아니다. 앱은 board_comments 를 RLS로 직접
--    읽으므로, 본문을 content 에 그대로 두면 누구나 REST 로 조회해서 볼 수 있다.
--    그래서 본문은 anon/authenticated 에게 select 권한을 주지 않는 별도 컬럼
--    (secret_content)에 넣고, 자격이 있는 사람에게만 Edge Function 이 확인 후
--    내려준다. content 에는 빈 문자열이 남아 목록엔 '🔒 비밀 댓글' 로만 보인다.
alter table public.board_comments
  add column if not exists is_secret      boolean not null default false,
  add column if not exists secret_content text;

comment on column public.board_comments.secret_content is
  '비밀 댓글 본문. anon/authenticated 에게 select 권한을 절대 주지 말 것 —
   권한을 주는 순간 앱에서 REST 로 직접 읽어 누구나 볼 수 있게 된다.';

-- is_secret 은 앱이 자물쇠 표시를 하려면 읽어야 한다. secret_content 는 주지 않는다.
grant select (is_secret) on public.board_comments to anon, authenticated;
