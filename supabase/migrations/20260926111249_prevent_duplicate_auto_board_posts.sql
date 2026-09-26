-- 자동 게시글은 제목이 달라도 본문이 같으면 재게시하지 않는다.
-- 이미 확인된 반복 문구도 대기·예약 단계에서 차단한다.

update public.auto_board_post_settings
   set auto_publish_enabled = false,
       updated_at = now()
 where id = true;

create or replace function private.auto_board_post_content_key(p_content text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(lower(coalesce(p_content, '')), '[^0-9a-z가-힣]+', '', 'g');
$$;

-- 기존 공개 글과 본문이 같거나 반복 문구가 있는 대기 글은 예약에서 제외한다.
update public.auto_board_posts as draft
   set status = 'rejected',
       scheduled_at = null,
       auto_publish_block_reason = case
         when draft.title ilike '%은근 궁금함%' or draft.content ilike '%은근 궁금함%'
           then '반복 문구가 포함되어 자동 게시에서 제외됐습니다'
         else '이미 공개된 글과 본문이 같아 자동 게시에서 제외됐습니다'
       end,
       generation_notes = concat_ws(E'\n', draft.generation_notes, '2026-09-26 중복 재발 방지 정리'),
       updated_at = now()
 where draft.status in ('ready', 'scheduled')
   and (
     draft.title ilike '%은근 궁금함%'
     or draft.content ilike '%은근 궁금함%'
     or exists (
       select 1
         from public.board_posts as published
        where published.is_active = true
          and published.auto_board_post_id is not null
          and private.auto_board_post_content_key(published.content)
              = private.auto_board_post_content_key(draft.content)
     )
   );

-- 아직 공개되지 않은 대기 글끼리도 같은 본문은 가장 먼저 만든 한 건만 남긴다.
with ranked as (
  select id,
         row_number() over (
           partition by private.auto_board_post_content_key(content)
           order by created_at, id
         ) as duplicate_order
    from public.auto_board_posts
   where status in ('ready', 'scheduled')
)
update public.auto_board_posts as draft
   set status = 'rejected',
       scheduled_at = null,
       auto_publish_block_reason = '대기 글 안에서 본문이 중복되어 자동 게시에서 제외됐습니다',
       generation_notes = concat_ws(E'\n', draft.generation_notes, '2026-09-26 중복 재발 방지 정리'),
       updated_at = now()
  from ranked
 where draft.id = ranked.id
   and ranked.duplicate_order > 1;

-- 이미 공개된 동일 본문은 가장 먼저 올라온 글만 남긴다.
with ranked as (
  select id,
         row_number() over (
           partition by private.auto_board_post_content_key(content)
           order by created_at, id
         ) as duplicate_order
    from public.board_posts
   where is_active = true
     and auto_board_post_id is not null
)
update public.board_posts as post
   set is_active = false,
       updated_at = now()
  from ranked
 where post.id = ranked.id
   and ranked.duplicate_order > 1;

create unique index if not exists auto_board_posts_open_content_key_uidx
  on public.auto_board_posts (
    (regexp_replace(lower(content), '[^0-9a-z가-힣]+', '', 'g'))
  )
  where status in ('ready', 'scheduled');

create or replace function private.reject_overused_auto_board_post_phrase()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status in ('ready', 'scheduled')
     and (new.title ilike '%은근 궁금함%' or new.content ilike '%은근 궁금함%') then
    new.status := 'draft';
    new.scheduled_at := null;
    new.auto_publish_block_reason := '반복 문구가 포함되어 자동 게시할 수 없습니다';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_overused_auto_board_post_phrase on public.auto_board_posts;
create trigger reject_overused_auto_board_post_phrase
before insert or update of title, content, status
on public.auto_board_posts
for each row
execute function private.reject_overused_auto_board_post_phrase();

create or replace function public.publish_auto_board_post(p_id uuid)
returns uuid
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  draft public.auto_board_posts%rowtype;
  post_id uuid;
  resolved_avatar_id text;
  resolved_created_at timestamptz;
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
  if draft.title ilike '%은근 궁금함%' or draft.content ilike '%은근 궁금함%' then
    raise exception '반복 문구가 포함된 초안은 게시할 수 없습니다';
  end if;
  if exists (
    select 1
      from public.board_posts as published
     where published.is_active = true
       and published.auto_board_post_id is not null
       and private.auto_board_post_content_key(published.content)
           = private.auto_board_post_content_key(draft.content)
  ) then
    raise exception '이미 공개된 자동 게시글과 본문이 같습니다';
  end if;

  resolved_avatar_id := coalesce(
    draft.avatar_id,
    'thumbs_' || lpad((((hashtext(draft.id::text) % 24 + 24) % 24) + 1)::text, 2, '0')
  );
  resolved_created_at := coalesce(draft.scheduled_at, now());

  insert into public.board_posts (
    nickname, title, content, owner_token, avatar_id, tag_id,
    is_active, auto_board_post_id, created_at
  ) values (
    draft.nickname, draft.title, draft.content, gen_random_uuid()::text,
    resolved_avatar_id, draft.tag_id, true, draft.id, resolved_created_at
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

revoke all on function private.auto_board_post_content_key(text) from public;
revoke all on function private.reject_overused_auto_board_post_phrase() from public;
revoke all on function public.publish_auto_board_post(uuid) from public, anon, authenticated;
grant execute on function public.publish_auto_board_post(uuid) to service_role;
