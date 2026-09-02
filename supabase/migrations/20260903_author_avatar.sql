-- 작성자 캐릭터(아바타) — 2026-09-03 오너 지시
--
-- 캐릭터 24종을 만들어 놓고 MY 화면 한 곳에서만 쓰고 있었다. 게다가 선택값이 기기
-- (AsyncStorage)에만 있어서 **내 캐릭터를 나만 볼 수 있었다** — 내가 쓴 글을 남이 보면
-- 닉네임 글자만 나온다. 글·댓글·후기에 캐릭터 id 를 같이 저장해 남에게도 보이게 한다.
--
-- ⚠️ board_posts·board_comments 는 **컬럼 단위 GRANT** 테이블이다. 새 컬럼에 grant 를
--    빠뜨리면 그 컬럼을 select 하는 순간 게시판 전체가 권한 오류로 안 열린다
--    (2026-09-01 is_notice 추가 때 실제로 겪었다 — 20260901_board_notice.sql 참고).
--    reviews·place_reviews 는 테이블 단위라 자동 포함이지만, 헷갈리지 않게 여기서 함께 적는다.

alter table public.board_posts    add column if not exists avatar_id text;
alter table public.board_comments add column if not exists avatar_id text;
alter table public.reviews        add column if not exists avatar_id text;
alter table public.place_reviews  add column if not exists avatar_id text;

comment on column public.board_posts.avatar_id is
  '작성 시점의 프리셋 캐릭터 id(thumbs_01~24). 앱 assets/avatars_anim 과 대응.';

grant select (avatar_id) on public.board_posts    to anon, authenticated;
grant select (avatar_id) on public.board_comments to anon, authenticated;

-- 기존 글에도 캐릭터를 넣는다(오너 지시: "기존글은 그냥 랜덤으로 아무거나 임의로").
-- ⚠️ 행마다 무작위로 뽑으면 **같은 사람이 쓴 글마다 캐릭터가 달라져** 오히려 이상하다.
--    owner_token(기기별 익명 식별값) 해시로 정해 같은 작성자는 늘 같은 캐릭터가 되게 한다.
--    결과는 사람마다 제각각이라 보기엔 무작위지만, 한 사람 안에서는 일관된다.
update public.board_posts    set avatar_id = 'thumbs_' || lpad((((hashtext(owner_token) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null and owner_token is not null;
update public.board_comments set avatar_id = 'thumbs_' || lpad((((hashtext(owner_token) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null and owner_token is not null;
update public.reviews        set avatar_id = 'thumbs_' || lpad((((hashtext(owner_token) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null and owner_token is not null;
update public.place_reviews  set avatar_id = 'thumbs_' || lpad((((hashtext(owner_token) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null and owner_token is not null;

-- owner_token 이 없는 옛 행(크롤링으로 들어온 외부 후기 등)은 닉네임으로 정한다.
update public.reviews       set avatar_id = 'thumbs_' || lpad((((hashtext(coalesce(author_name,'')) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null;
update public.place_reviews set avatar_id = 'thumbs_' || lpad((((hashtext(coalesce(author_name,'')) % 24 + 24) % 24) + 1)::text, 2, '0') where avatar_id is null;
