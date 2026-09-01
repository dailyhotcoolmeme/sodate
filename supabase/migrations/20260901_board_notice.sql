-- 커뮤니티 공지글 (2026-09-01 오너 지시)
--
-- 운영자가 admin 에서 글을 쓰면 게시판 맨 위에 고정된다. 작성자는 '모잇 운영자'.
-- 공지는 여러 개 올릴 수 있고 전부 상단에 최신순으로 쌓인다(오너 확정).
-- 댓글은 받되 추천·비추천은 받지 않는다(공지에 비추천이 쌓이는 그림을 피한다).
--
-- 앱은 is_notice 를 모르는 구버전(1.1.0 이하)에서도 깨지지 않는다 —
-- 그냥 '모잇 운영자'가 쓴 일반 글로 최신순 자리에 보일 뿐이다.
-- 상단 고정·배지·추천 숨김은 다음 스토어 배포에 들어간다.

alter table board_posts
  add column if not exists is_notice boolean not null default false;

comment on column board_posts.is_notice is
  '공지글 여부. true 면 앱 목록 최상단에 고정되고 추천·비추천 버튼이 숨겨진다. admin 에서만 지정.';

-- 목록 질의가 항상 (활성 글 → 공지 먼저 → 최신순) 이라 그 순서 그대로 인덱스를 만든다.
create index if not exists board_posts_notice_created_idx
  on board_posts (is_notice desc, created_at desc)
  where is_active;
