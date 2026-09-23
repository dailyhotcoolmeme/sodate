-- 기존 자동 초안과 이미 게시된 자동 글에 앱 내장 프로필 이미지를 배정한다.
-- id 해시로 고르므로 한 글의 프로필이 조회할 때마다 바뀌지 않는다.
update public.auto_board_posts
   set avatar_id = 'thumbs_' || lpad((((hashtext(id::text) % 24 + 24) % 24) + 1)::text, 2, '0'),
       updated_at = now()
 where avatar_id is null;

update public.board_posts as post
   set avatar_id = draft.avatar_id
  from public.auto_board_posts as draft
 where post.auto_board_post_id = draft.id
   and post.avatar_id is null;

-- 이전 초안이나 admin 직접 추가 자료에 프로필이 빠져도
-- 게시 시점에 반드시 24종 중 하나가 들어가게 한다.
create or replace function public.publish_auto_board_post(p_id uuid)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  draft public.auto_board_posts%rowtype;
  post_id uuid;
  resolved_avatar_id text;
begin
  select * into draft
    from public.auto_board_posts
   where id = p_id
   for update;

  if not found then
    raise exception '자동 게시글 초안을 찾을 수 없습니다';
  end if;
  if draft.status = 'published' and draft.published_post_id is not null then
    return draft.published_post_id;
  end if;
  if draft.status = 'rejected' then
    raise exception '반려된 초안은 게시할 수 없습니다';
  end if;

  resolved_avatar_id := coalesce(
    draft.avatar_id,
    'thumbs_' || lpad((((hashtext(draft.id::text) % 24 + 24) % 24) + 1)::text, 2, '0')
  );

  insert into public.board_posts (
    nickname, title, content, owner_token, avatar_id, tag_id,
    is_active, auto_board_post_id
  ) values (
    draft.nickname, draft.title, draft.content, gen_random_uuid()::text,
    resolved_avatar_id, draft.tag_id, true, draft.id
  ) returning id into post_id;

  update public.auto_board_posts
     set status = 'published',
         avatar_id = resolved_avatar_id,
         published_post_id = post_id,
         published_at = now(),
         updated_at = now()
   where id = draft.id;

  return post_id;
end;
$$;

revoke all on function public.publish_auto_board_post(uuid) from public, anon, authenticated;
grant execute on function public.publish_auto_board_post(uuid) to service_role;
