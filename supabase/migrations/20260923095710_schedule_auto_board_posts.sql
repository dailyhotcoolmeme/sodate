-- 검수를 통과한 자동 글만 한국 시간 10:00~다음 날 01:00 사이에 예약·게시한다.
-- 예약은 매일 09:40 KST에 만들고, 게시 작업은 5분마다 실행한다.

create schema if not exists private;

alter table public.auto_board_posts
  add column if not exists auto_publish_block_reason text;

update public.auto_board_post_settings
   set generation_batch_size = 90,
       updated_at = now()
 where id = true;

create or replace function private.auto_board_post_block_reason(
  p_title text,
  p_content text,
  p_tag_id uuid
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  merged text := coalesce(p_title, '') || ' ' || coalesce(p_content, '');
  compact text := regexp_replace(lower(merged), '[[:space:]]+', '', 'g');
  tag_label text;
begin
  if merged ~ '(:\)|[ㅠㅜ]|ㅎ{2,}|[.])' then
    return '승인되지 않은 말투·기호가 포함되어 있습니다';
  end if;

  if merged ~ 'ㅋ{4,}' then
    return '웃음 표현은 ㅋㅋ 또는 ㅋㅋㅋ만 사용할 수 있습니다';
  end if;

  if compact ~ '(오늘|내일|어제|지금|방금|이번주|주말|평일|월요일|화요일|수요일|목요일|금요일|토요일|일요일|아침|오전|점심|퇴근|저녁|밤|새벽|비오|비가|비와|눈오|눈이|눈와|날씨|기온|더위|추위|밤공기|계절|시간째)'
     or merged ~ '[0-9]{1,2}[[:space:]]*시(에|쯤|부터|까지|$|[[:space:],?!])' then
    return '게시 시각이나 실제 날씨와 어긋날 수 있는 표현이 있습니다';
  end if;

  select trim(both '[] ' from label)
    into tag_label
    from public.board_tags
   where id = p_tag_id;

  if tag_label = '리얼후기'
     and compact !~ '(소개팅|로소|로테이션|소셜링|혼술바|매칭|애프터|친구소개)' then
    return '리얼후기는 소개팅·소셜링·혼술바 실제 이용 경험이어야 합니다';
  end if;

  return null;
end;
$$;

create or replace function private.validate_auto_board_post_for_publish()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  new.auto_publish_block_reason := private.auto_board_post_block_reason(
    new.title,
    new.content,
    new.tag_id
  );

  if new.status in ('ready', 'scheduled')
     and new.auto_publish_block_reason is not null then
    new.status := 'draft';
    new.scheduled_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_auto_board_post_for_publish on public.auto_board_posts;
create trigger validate_auto_board_post_for_publish
before insert or update of title, content, tag_id, status
on public.auto_board_posts
for each row
execute function private.validate_auto_board_post_for_publish();

-- 매일 한 번 실행된다. 함수 전체가 한 트랜잭션이라 중간까지만 예약되지 않는다.
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

  -- 전날 장애로 게시되지 못한 글은 아침에 몰아서 올리지 않고 다음 예약 후보로 돌린다.
  update public.auto_board_posts
     set status = 'ready',
         scheduled_at = null,
         updated_at = now()
   where status = 'scheduled'
     and scheduled_at < window_start
     and published_post_id is null;

  -- 같은 날짜 계획이 이미 만들어졌으면 중복 예약하지 않는다.
  if exists (
    select 1
      from public.auto_board_posts
     where scheduled_at >= window_start
       and scheduled_at < window_end
  ) then
    return 0;
  end if;

  -- 저장 이후 수정으로 차단 조건이 생긴 승인 글은 다시 검토 대기로 돌린다.
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
           + make_interval(mins => case
               when post_count = 2 and slot_no = 1 then 5 + 5 * floor(random() * 5)::integer
               when post_count = 2 and slot_no = 2 then 35 + 5 * floor(random() * 5)::integer
               when post_count >= 3 and slot_no = 1 then 5 + 5 * floor(random() * 3)::integer
               when post_count >= 3 and slot_no = 2 then 25 + 5 * floor(random() * 3)::integer
               else 45 + 5 * floor(random() * 3)::integer
             end) as scheduled_at
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

create or replace function private.publish_due_auto_board_posts()
returns integer
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  settings public.auto_board_post_settings%rowtype;
  local_now timestamp := now() at time zone 'Asia/Seoul';
  active_day date;
  window_start timestamptz;
  window_end timestamptz;
  draft record;
  published_count integer := 0;
begin
  select * into settings
    from public.auto_board_post_settings
   where id = true;

  if not found or not settings.auto_publish_enabled then
    return 0;
  end if;

  if local_now::time >= time '10:00' then
    active_day := local_now::date;
  elsif local_now::time < time '01:00' then
    active_day := local_now::date - 1;
  else
    return 0;
  end if;

  window_start := (active_day::timestamp + time '10:00') at time zone 'Asia/Seoul';
  window_end := ((active_day + 1)::timestamp + time '01:00') at time zone 'Asia/Seoul';

  for draft in
    select id
      from public.auto_board_posts
     where status = 'scheduled'
       and scheduled_at >= window_start
       and scheduled_at < window_end
       and scheduled_at <= now()
     order by scheduled_at
     for update skip locked
     limit 10
  loop
    begin
      perform public.publish_auto_board_post(draft.id);
      published_count := published_count + 1;
    exception when others then
      update public.auto_board_posts
         set status = 'failed',
             generation_notes = concat_ws(E'\n', generation_notes, '자동 게시 실패: ' || sqlerrm),
             updated_at = now()
       where id = draft.id;
    end;
  end loop;

  return published_count;
end;
$$;

revoke all on function private.auto_board_post_block_reason(text, text, uuid) from public;
revoke all on function private.validate_auto_board_post_for_publish() from public;
revoke all on function private.plan_auto_board_posts(date, timestamptz) from public;
revoke all on function private.publish_due_auto_board_posts() from public;
grant usage on schema private to service_role;
grant execute on function private.auto_board_post_block_reason(text, text, uuid) to service_role;

-- cron은 UTC다. 00:40 UTC=09:40 KST, 01:00~15:55 UTC=10:00~00:55 KST.
select cron.schedule(
  'auto-board-plan-daily',
  '40 0 * * *',
  $cron$select private.plan_auto_board_posts();$cron$
);

select cron.schedule(
  'auto-board-publish-due',
  '*/5 1-15 * * *',
  $cron$select private.publish_due_auto_board_posts();$cron$
);

-- pg_cron 실행 이력이 계속 쌓이지 않게 자동 게시 작업의 7일 이전 기록만 지운다.
select cron.schedule(
  'auto-board-cron-history-cleanup',
  '20 16 * * *',
  $cron$
    delete from cron.job_run_details
     where end_time < now() - interval '7 days'
       and jobid in (
         select jobid
           from cron.job
          where jobname like 'auto-board-%'
       );
  $cron$
);
