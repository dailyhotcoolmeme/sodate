-- 개인정보 보유기간 자동 파기 (2026-08-13).
--
-- 왜 만들었나: 개인정보처리방침 3항에 항목별 보유기간을 명시했는데, 실제로 파기하는
-- 코드가 없으면 방침이 또 사실과 달라진다. 방침에 적은 기간과 여기 숫자는 반드시 같아야
-- 한다 — 한쪽만 고치지 말 것.
--   · 비밀 댓글 내용(연락처 포함) : 6개월
--   · 앱 이용 기록(analytics)      : 12개월
--   · 푸시 토큰(장기 미사용)        : 12개월
--
-- 도입 시점 기준 파기 대상은 0건이었다(2026-08-13 실측). 즉 켜는 순간 지워지는 건 없고,
-- 앞으로 기간이 찬 것부터 하루 한 번 정리된다.

create or replace function public.purge_expired_personal_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret int := 0;
  v_events int := 0;
  v_tokens int := 0;
begin
  -- 비밀 댓글은 '내용만' 지운다. 행 자체를 지우면 대댓글이 cascade로 함께 사라지고
  -- 댓글 수가 어긋난다. 내용을 비우면 화면에서는 기존 잠금 표시와 똑같이 보인다.
  update public.board_comments
     set secret_content = null
   where is_secret
     and secret_content is not null
     and created_at < now() - interval '6 months';
  get diagnostics v_secret = row_count;

  delete from public.analytics_events
   where created_at < now() - interval '12 months';
  get diagnostics v_events = row_count;

  -- 오래 안 쓴 기기의 푸시 토큰. 알림 구독 조건도 함께 정리된다(FK on delete cascade).
  delete from public.push_tokens
   where last_seen_at is not null
     and last_seen_at < now() - interval '12 months';
  get diagnostics v_tokens = row_count;

  return jsonb_build_object(
    'ran_at', now(),
    'secret_comments_cleared', v_secret,
    'analytics_deleted', v_events,
    'push_tokens_deleted', v_tokens
  );
end $$;

-- 앱(anon)이 부를 일은 없다. 스케줄러(postgres)와 운영자만.
revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;

create extension if not exists pg_cron;

-- 매일 04:10 KST (UTC 19:10). 크롤링·워치독이 도는 시간대를 피한다.
select cron.unschedule('purge-expired-personal-data')
 where exists (select 1 from cron.job where jobname = 'purge-expired-personal-data');

select cron.schedule(
  'purge-expired-personal-data',
  '10 19 * * *',
  $$select public.purge_expired_personal_data()$$
);
