-- 워치독 알림 이력 테이블 잠그기 (2026-08-13, 보안 감사에서 발견).
--
-- 사고 내용: crawler/watchdog.py 가 upsert 로 이 표를 만들면서 007_rls_policies.sql 같은
-- 정책 파일을 한 번도 거치지 않았다. 그 결과 RLS 가 꺼진 채 anon 에게 SELECT/INSERT/
-- UPDATE/DELETE/TRUNCATE 가 전부 열려 있었다. 앱에 심긴 anon 키만 있으면 누구나
--   · 내부 운영 메모(어떤 업체 크롤이 깨졌는지 등)를 전부 읽고
--   · 알림 이력을 지우거나 last_sent_at 을 미래로 조작해 워치독 경보를 영구히 침묵
-- 시킬 수 있었다. 크롤러가 죽어도 오너가 통보를 못 받게 되는 경로다.
--
-- 이 표는 워치독(service_role)만 쓴다. 정책을 하나도 만들지 않으면 RLS 가 켜진 것만으로
-- anon/authenticated 는 전부 차단되고, service_role 은 RLS 를 우회하므로 그대로 동작한다.
alter table public.watchdog_alerts enable row level security;

-- 정책이 없어도 GRANT 가 남아 있으면 오해의 소지가 있어 함께 회수한다.
revoke all on public.watchdog_alerts from anon, authenticated;
