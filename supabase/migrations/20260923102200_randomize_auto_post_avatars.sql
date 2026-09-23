-- 실제 게시 순서 기준으로 프로필 이미지 24종을 무작위로 섞는다.
-- 한 묶음 안에서는 같은 이미지가 중복되지 않고, 24종을 다 쓴 뒤 다시 섞을 때도
-- 직전 이미지와 새 묶음 첫 이미지가 같지 않게 한다.

create or replace function private.randomize_auto_board_schedule_avatars(
  p_day date default ((now() at time zone 'Asia/Seoul')::date)
)
returns integer
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  window_start timestamptz;
  window_end timestamptz;
  avatar_ids text[];
  avatar_index integer := 25;
  previous_avatar text;
  selected_avatar text;
  swap_avatar text;
  scheduled_post record;
  changed_count integer := 0;
begin
  window_start := (p_day::timestamp + time '10:00') at time zone 'Asia/Seoul';
  window_end := ((p_day + 1)::timestamp + time '01:00') at time zone 'Asia/Seoul';

  select avatar_id
    into previous_avatar
    from public.auto_board_posts
   where status = 'published'
     and scheduled_at >= window_start
     and scheduled_at < window_end
   order by scheduled_at desc
   limit 1;

  for scheduled_post in
    select id
      from public.auto_board_posts
     where status = 'scheduled'
       and scheduled_at >= window_start
       and scheduled_at < window_end
     order by scheduled_at, id
     for update
  loop
    if avatar_index > 24 then
      select array_agg(
               'thumbs_' || lpad(avatar_number::text, 2, '0')
               order by random()
             )
        into avatar_ids
        from generate_series(1, 24) as avatar_number;
      avatar_index := 1;

      if previous_avatar is not null and avatar_ids[1] = previous_avatar then
        swap_avatar := avatar_ids[1];
        avatar_ids[1] := avatar_ids[2];
        avatar_ids[2] := swap_avatar;
      end if;
    end if;

    selected_avatar := avatar_ids[avatar_index];
    update public.auto_board_posts
       set avatar_id = selected_avatar,
           updated_at = now()
     where id = scheduled_post.id;

    previous_avatar := selected_avatar;
    avatar_index := avatar_index + 1;
    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$$;

revoke all on function private.randomize_auto_board_schedule_avatars(date) from public;

-- 예약 생성 직후 같은 DB 작업 안에서 프로필 이미지 순서도 다시 섞는다.
select cron.schedule(
  'auto-board-plan-daily',
  '40 0 * * *',
  $cron$
    select private.plan_auto_board_posts();
    select private.randomize_auto_board_schedule_avatars();
  $cron$
);
