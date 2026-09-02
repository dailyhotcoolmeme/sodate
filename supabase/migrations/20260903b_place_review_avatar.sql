-- 혼술바 후기에도 작성자 캐릭터를 남긴다 — 2026-09-03
--
-- 글·댓글·이벤트 후기는 Edge Function 이라 코드에서 넣으면 되는데, 매장 후기만 RPC
-- (SECURITY DEFINER)라 함수 자체를 바꿔야 한다. 인자를 뒤에 하나 늘리면 옛 시그니처가
-- 오버로드로 남아 어느 쪽이 불릴지 애매해지므로, 옛 함수는 지우고 새로 만든다.
-- (구버전 앱이 인자 5개로 호출하면 오류가 난다 — 하지만 이 기능은 다음 스토어 배포와 함께
--  나가고, 후기 작성은 실패해도 되돌릴 수 있는 동작이라 그대로 진행한다.)

drop function if exists public.submit_place_review(uuid, text, text, integer, text);

create or replace function public.submit_place_review(
  p_place_id uuid, p_owner_token text, p_nickname text, p_rating integer, p_content text,
  p_avatar_id text default null
) returns place_reviews
language plpgsql security definer set search_path to 'public' as $$
declare
  r public.place_reviews;
  v_avatar text;
begin
  -- 앱이 보낸 값은 thumbs_01~24 만 받는다(공개 컬럼이라 임의 문자열이 들어가면 안 된다).
  -- 아직 캐릭터를 안 고른 기기면 소유권 토큰 해시로 정해준다 — 옛 글 일괄 배정과 같은 규칙이라
  -- 같은 사람은 늘 같은 캐릭터가 된다.
  v_avatar := case
    when p_avatar_id ~ '^thumbs_(0[1-9]|1[0-9]|2[0-4])$' then p_avatar_id
    else 'thumbs_' || lpad((((hashtext(p_owner_token) % 24 + 24) % 24) + 1)::text, 2, '0')
  end;

  insert into public.place_reviews(place_id, source, content, author_name, rating, owner_token, avatar_id, published_at)
  values (p_place_id, 'user', p_content, p_nickname, p_rating, p_owner_token, v_avatar, now())
  returning * into r;
  return r;
end; $$;

grant execute on function public.submit_place_review(uuid, text, text, integer, text, text) to anon, authenticated;
