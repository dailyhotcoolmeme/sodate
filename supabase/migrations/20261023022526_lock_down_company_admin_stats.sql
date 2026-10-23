-- 관리자 통계는 세션 인증된 admin /api/sb 프록시(service_role)만 사용한다.
-- 집계 정의와 원본 데이터는 변경하지 않는다. 익명/일반 로그인 역할은 접근 금지.
alter view public.company_admin_stats set (security_invoker = true);
revoke all on table public.company_admin_stats from public, anon, authenticated;
grant select on table public.company_admin_stats to service_role;
notify pgrst, 'reload schema';
