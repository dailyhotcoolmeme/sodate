-- 제휴 업체 전용 등록 포털 — 2026-09-05 오너 지시로 설계·확정.
-- 설계 전체 배경은 memory `project_sodate_partner_portal_design`(세션 밖 기록) 참고.
--
-- 핵심 결정: 크롤링된 기존 일정은 손 안 대고, 업체가 완전히 새 일정을 직접 등록한다.
-- 중복 여부는 판단하지 않는다(오너 지시). 대신 직접 등록분에만 "모잇 Pick" 배지를 켠다.
--
-- 크롤러와 안 부딪히는 이유: base_scraper.py 가 이미 verified=true 인 행은
-- 지난 일정 정리·스테일 삭제에서 전부 건너뛴다("verified는 절대 안 건드림").
-- 포털에서 저장할 때 verified=true 로 찍기만 하면 크롤러 쪽은 코드 변경이 필요 없다.

-- ── 파트너 계정 ──────────────────────────────────────────────────────────────
-- admin 의 단일 ID/PW(env var, admin/functions/api/login.ts)와 달리 업체가 여럿이라
-- 테이블이 불가피하다. 비밀번호는 반드시 해시(bcrypt 등)로 저장 — 평문 금지.
--
-- ⚠️ RLS를 켜고 정책을 하나도 안 둔다 — anon/authenticated 는 완전히 막히고,
--    포털 서버(Edge Function, service_role 키)만 RLS를 우회해 접근한다.
--    board_reports 같은 공개 테이블과 달리 이 테이블은 앱/PostgREST로 절대 안 열어준다.
create table if not exists public.partner_accounts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  email              text not null unique,
  password_hash      text not null,
  status             text not null default 'active',
  invite_token       text unique,
  invite_expires_at  timestamptz,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz
);

alter table public.partner_accounts enable row level security;

alter table public.partner_accounts drop constraint if exists partner_accounts_status_check;
alter table public.partner_accounts add constraint partner_accounts_status_check
  check (status in ('active', 'disabled'));

comment on table public.partner_accounts is
  '제휴 업체가 포털에 직접 로그인하는 계정. anon/authenticated 접근 금지(RLS 정책 없음) — '
  '반드시 service_role 로만 다룬다. password_hash 는 반드시 해시(평문 저장 금지).';
comment on column public.partner_accounts.status is
  'active=로그인 가능, disabled=제휴 종료(오너가 admin에서 정지). 계정 자체는 안 지운다 — '
  '데이터 보존, 재개 시 active 로만 되돌리면 됨.';
comment on column public.partner_accounts.invite_token is
  '1회용 초대 토큰. 업체가 최초 비밀번호를 설정하면 즉시 null 처리해 재사용을 막는다.';

create index if not exists partner_accounts_company_idx on public.partner_accounts(company_id);

-- ── 제휴 등급(무료/유료) ────────────────────────────────────────────────────
-- 기존 plan(free/partner)은 "제휴 여부"만 구분한다. 유료 등급 전용 기능(배너 광고
-- 업로드)을 가리려면 등급이 따로 필요하다 — 오너가 admin '제휴 관리' 화면의
-- 기존 스위치 옆에서 언제든 바꾼다.
alter table public.companies add column if not exists partner_tier text;

alter table public.companies drop constraint if exists companies_partner_tier_check;
alter table public.companies add constraint companies_partner_tier_check
  check (partner_tier is null or partner_tier in ('free', 'paid'));

comment on column public.companies.partner_tier is
  '제휴 등급. free=배너 메뉴 안 보임, paid=배너 광고 업로드 가능. plan=''partner''일 때만 의미 있음.';

-- ── 파트너 직접 등록 배지 ────────────────────────────────────────────────────
-- verified=true 는 "오너가 admin에서 검수한 크롤 데이터"에도 이미 쓰이므로, 그것만으로는
-- "업체가 포털에서 직접 등록했다"를 못 가려낸다. 이 칼럼 하나로 "모잇 Pick" 배지를 켠다.
-- events 는 테이블 단위 GRANT라 anon/authenticated 에 자동 노출된다(20260814 참고,
-- 별도 grant 불필요).
alter table public.events add column if not exists is_partner_direct boolean not null default false;

comment on column public.events.is_partner_direct is
  '제휴 업체가 포털에서 직접 등록한 일정이면 true — 앱에서 "모잇 Pick" 배지를 켠다. '
  '크롤러가 만든 일정은 항상 false. 이 값과 무관하게 저장 시 verified=true 도 같이 찍어야 '
  '크롤러의 지난 일정 정리·스테일 삭제에서 제외된다(base_scraper.py 참고).';

create index if not exists events_partner_direct_idx on public.events(is_partner_direct)
  where is_partner_direct = true;
