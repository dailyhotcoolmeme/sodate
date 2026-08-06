-- 게시판 신고(board_reports) 접수 시 운영자에게 이메일로 알린다(애플 1.2 UGC 요건 —
-- 신고 후 24시간 내 조치를 하려면 관리자가 즉시 알아야 한다).
--
-- Supabase 대시보드의 Database Webhooks 기능 대신 pg_net 트리거로 직접 만들었다
-- (2026-08-03, CLI 로만 접근 가능한 환경). 시크릿은 이 파일에 평문으로 두지 않고
-- Vault(vault.decrypted_secrets, name='board_report_hook_secret')에서 읽는다 — 실제
-- 값은 별도로(마이그레이션 밖에서) vault.create_secret 로 한 번만 넣는다.

create extension if not exists pg_net;

create or replace function public.fn_board_report_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'board_report_hook_secret';

  -- 시크릿이 아직 안 들어가 있으면(운영 초기) 조용히 건너뛴다 — 신고 자체는 막지 않는다.
  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://xgcldcnqfqcugkcifyae.supabase.co/functions/v1/notify-admin-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- 공개용 anon key — Edge Function 게이트웨이의 JWT 검증만 통과시키는 용도.
      -- 실제 권한 확인은 x-webhook-secret 으로 한다.
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhnY2xkY25xZnFjdWdrY2lmeWFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODc3MzQsImV4cCI6MjA4OTQ2MzczNH0.CAMif1LTGFHafz7ZJFcoI72pXnuCwEPV-3c-6z96mNI',
      'x-webhook-secret', v_secret
    ),
    body := jsonb_build_object('record', jsonb_build_object('id', new.id)),
    timeout_milliseconds := 8000
  );

  return new;
end;
$$;

drop trigger if exists trg_board_report_notify on public.board_reports;
create trigger trg_board_report_notify
  after insert on public.board_reports
  for each row execute function public.fn_board_report_notify();
