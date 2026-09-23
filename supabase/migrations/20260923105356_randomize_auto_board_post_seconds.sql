-- 자동 게시 시각의 초가 모두 00으로 보이지 않게 예약마다 00~59초를 무작위 배정한다.
-- 공개 글의 created_at에도 예약 시각을 그대로 사용해 앱의 표시 시각과 예약 시각을 맞춘다.

create or replace function private.plan_auto_board_posts(
  p_day date default ((now() at time zone 'Asia/Seoul')::date),
  p_not_before timestamptz default null
)
returns integer
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  settings public.auto_board_post_settings%rowtype;
  window_start timestamptz;
  window_end timestamptz;
  planned_count integer := 0;
begin
  select * into settings
    from public.auto_board_post_settings
   where id = true;

  if not found or not settings.auto_publish_enabled then
    return 0;
  end if;

  window_start := (p_day::timestamp + time '10:00') at time zone 'Asia/Seoul';
  window_end := ((p_day + 1)::timestamp + time '01:00') at time zone 'Asia/Seoul';

  update public.auto_board_posts
     set status = 'ready',
         scheduled_at = null,
         updated_at = now()
   where status = 'scheduled'
     and scheduled_at < window_start
     and published_post_id is null;

  if exists (
    select 1
      from public.auto_board_posts
     where scheduled_at >= window_start
       and scheduled_at < window_end
  ) then
    return 0;
  end if;

  update public.auto_board_posts
     set status = 'draft',
         scheduled_at = null,
         auto_publish_block_reason = private.auto_board_post_block_reason(title, content, tag_id),
         updated_at = now()
   where status = 'ready'
     and private.auto_board_post_block_reason(title, content, tag_id) is not null;

  with hour_plan as (
    select hour_start,
           floor(random() * (settings.posts_per_hour_max - settings.posts_per_hour_min + 1))::integer
             + settings.posts_per_hour_min as post_count
      from generate_series(
        window_start,
        window_end - interval '1 hour',
        interval '1 hour'
     ) as hour_start
     where p_not_before is null
        or hour_start >= date_trunc('hour', p_not_before)
  ),
  planned_times as (
    select hour_start
           + make_interval(
               mins => case
                 when post_count = 2 and slot_no = 1 then 5 + 5 * floor(random() * 5)::integer
                 when post_count = 2 and slot_no = 2 then 35 + 5 * floor(random() * 5)::integer
                 when post_count >= 3 and slot_no = 1 then 5 + 5 * floor(random() * 3)::integer
                 when post_count >= 3 and slot_no = 2 then 25 + 5 * floor(random() * 3)::integer
                 else 45 + 5 * floor(random() * 3)::integer
               end,
               secs => floor(random() * 60)::integer
             ) as scheduled_at
      from hour_plan
      cross join lateral generate_series(1, post_count) as slot_no
  ),
  ranked_times as (
    select scheduled_at, row_number() over (order by scheduled_at) as row_no
      from planned_times
     where p_not_before is null
        or scheduled_at >= p_not_before + interval '5 minutes'
  ),
  candidates as (
    select id, row_number() over (order by created_at, id) as row_no
      from public.auto_board_posts
     where status = 'ready'
       and published_post_id is null
       and auto_publish_block_reason is null
     order by created_at, id
     limit 100
  ),
  paired as (
    select candidates.id, ranked_times.scheduled_at
      from candidates
      join ranked_times using (row_no)
  )
  update public.auto_board_posts as post
     set status = 'scheduled',
         scheduled_at = paired.scheduled_at,
         updated_at = now()
    from paired
   where post.id = paired.id;

  get diagnostics planned_count = row_count;
  return planned_count;
end;
$$;

create or replace function public.publish_auto_board_post(p_id uuid)
returns uuid
language plpgsql
set search_path = public
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

-- 오늘 이미 예약된 글과 게시된 자동 글도 분은 그대로 두고 초만 무작위로 보정한다.
update public.auto_board_posts
   set scheduled_at = date_trunc('minute', scheduled_at)
                      + make_interval(secs => floor(random() * 60)::integer),
       updated_at = now()
 where scheduled_at is not null
   and extract(second from scheduled_at) = 0;

update public.board_posts as post
   set created_at = draft.scheduled_at
  from public.auto_board_posts as draft
 where post.auto_board_post_id = draft.id
   and draft.scheduled_at is not null
   and post.created_at is distinct from draft.scheduled_at;
