-- 제휴업체 딱지('모잇 할인') — 2026-09-02 오너 지시
--
-- companies 에는 plan / plan_expires_at 이 이미 있었지만 코드에서 한 번도 안 썼다.
-- 이제 plan='partner' 를 딱지 표시의 정본으로 쓴다(값 오타 방지용 check 만 추가).
--
-- 소개팅·소셜링은 제휴 기간을 두지 않는다(오너 판단): 일정 자체가 날짜가 지나면
-- 피드에서 사라지므로 기간 관리가 따로 필요 없다. 그래서 companies 에는
-- plan_expires_at 이 있어도 쓰지 않는다.
--
-- 혼술바(places)는 상시 노출되는 매장이라 기간이 필요하다 → 시작·종료 날짜를 둔다.
-- admin 에서 날짜를 넣고, 앱은 오늘이 그 사이일 때만 딱지를 보여준다.
--
-- ⚠️ 컬럼 단위 GRANT 확인함: places·companies 는 anon/authenticated 에 **테이블 단위**
--    SELECT 가 걸려 있어 새 컬럼이 자동으로 읽힌다. (board_posts 는 컬럼 단위라
--    is_notice 추가 때 앱이 멈췄었다 — 20260901_board_notice.sql 참고. 여긴 해당 없음.)

alter table public.places
  add column if not exists plan           text not null default 'free',
  add column if not exists plan_starts_at date,
  add column if not exists plan_ends_at   date;

comment on column public.places.plan is
  '제휴 상태. free=일반, partner=제휴(모잇 할인 딱지). 기간은 plan_starts_at~plan_ends_at.';
comment on column public.places.plan_starts_at is
  '제휴 시작일(null=제한 없음). 앱은 오늘이 시작~종료 사이일 때만 딱지를 그린다.';
comment on column public.places.plan_ends_at is
  '제휴 종료일(null=무기한). 이 날짜까지 딱지가 보인다.';

alter table public.places drop constraint if exists places_plan_check;
alter table public.places add  constraint places_plan_check check (plan in ('free', 'partner'));

alter table public.companies drop constraint if exists companies_plan_check;
alter table public.companies add  constraint companies_plan_check check (plan in ('free', 'partner'));

comment on column public.companies.plan is
  '제휴 상태. free=일반, partner=제휴(모잇 할인 딱지). 소개팅·소셜링은 기간을 쓰지 않는다.';

-- 제휴사는 전체의 극히 일부라 부분 인덱스로 충분하다(admin 목록에서 제휴만 골라볼 때).
create index if not exists places_partner_idx    on public.places(plan)    where plan = 'partner';
create index if not exists companies_partner_idx on public.companies(plan) where plan = 'partner';

-- ── 혜택 내용(2026-09-02 오너 지시, 딱지 붙인 직후 추가) ───────────────────────
-- 딱지에 '모잇 할인'이라고만 쓰면 사용자가 "얼마?"를 물었을 때 앱이 답을 못 한다.
-- 혜택은 업체마다 다르므로(5,000원 할인 / 10% / 웰컴드링크 …) 업체별로 적어둔다.
-- 상세 진입 팝업과 제목 위 한 줄에 이 값이 그대로 들어간다.
--
-- 비어 있으면 혜택 줄은 **아예 안 그린다**(오너 지시) — "할인됩니다" 같은 빈 말을
-- 채워 넣지 않는다. 행동 안내 문장만 남는다.
alter table public.companies add column if not exists partner_benefit text;
alter table public.places    add column if not exists partner_benefit text;

comment on column public.companies.partner_benefit is
  '제휴 혜택 문구(예: ''5,000원 할인''). 비면 앱에서 혜택 줄을 안 그린다.';
comment on column public.places.partner_benefit is
  '제휴 혜택 문구(예: ''칵테일 1잔 서비스''). 비면 앱에서 혜택 줄을 안 그린다.';
