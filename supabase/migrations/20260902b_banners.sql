-- 메뉴별 상단 배너 — 2026-09-02 오너 지시
--
-- 지금까지 배너는 커뮤니티 한 곳뿐이었고 이미지 주소·링크가 앱 코드에 상수로 박혀 있었다
-- (app/components/BoardPromoBanner.tsx). 배너 하나 바꾸려고 앱을 다시 배포해야 했다.
-- 이제 4개 메뉴(소개팅·소셜링·혼술바·커뮤니티)가 각각 독립으로, admin 에서 관리된다.
--
-- 스위치가 두 겹인 이유:
--   · banner_settings.enabled  — 메뉴 통째로 끄기. 배너가 0장이어도 스위치는 있어야 해서
--                                banners 안에 둘 수 없다.
--   · banners.is_active        — 배너 한 장씩 끄기(지웠다 다시 올리지 않아도 되게).

create table if not exists public.banners (
  id            uuid primary key default gen_random_uuid(),
  menu          text not null check (menu in ('dating', 'socialing', 'honsul', 'board')),
  image_url     text not null,
  -- 링크 대상. 제휴사 배너는 외부가 아니라 앱 안 화면으로 보내야 이탈이 없다(오너 확정).
  --   url=외부 주소 / event·company·place=앱 내부 화면 id / none=누를 수 없는 안내용
  target_type   text not null default 'url'
                check (target_type in ('url', 'event', 'company', 'place', 'none')),
  target_value  text,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  -- 노출 기간(KST 날짜). 비우면 제한 없음.
  starts_at     date,
  ends_at       date,
  -- admin 목록에서 어느 배너인지 알아보려고. 사용자에게는 안 보인다.
  memo          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.banners is
  '메뉴 상단 배너. 규격 1110x276(4:1) WebP. ⚠️ 이미지에 둥근 모서리를 굽지 말 것 —
   앱이 자르는 반지름과 어긋나 다크모드에서 네 귀퉁이에 흰 실선이 남는다(2026-08-19 사고).';

create index if not exists banners_menu_order_idx on public.banners(menu, sort_order);

create table if not exists public.banner_settings (
  menu       text primary key check (menu in ('dating', 'socialing', 'honsul', 'board')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.banner_settings (menu, enabled) values
  ('dating', true), ('socialing', true), ('honsul', true), ('board', true)
on conflict (menu) do nothing;

-- 앱은 이 뷰 하나만 본다. 메뉴 스위치·배너 스위치·기간을 **서버에서** 다 거른다 —
-- 앱이 날짜를 계산하면 기기 표준시(해외 사용자)에 따라 하루가 밀린다.
create or replace view public.active_banners as
select b.id, b.menu, b.image_url, b.target_type, b.target_value, b.sort_order
from public.banners b
join public.banner_settings s on s.menu = b.menu and s.enabled
where b.is_active
  and (b.starts_at is null or b.starts_at <= (now() at time zone 'Asia/Seoul')::date)
  and (b.ends_at   is null or b.ends_at   >= (now() at time zone 'Asia/Seoul')::date)
order by b.sort_order, b.created_at;

alter table public.banners         enable row level security;
alter table public.banner_settings enable row level security;

-- 읽기만 공개. 쓰기는 admin 이 service_role 프록시(/api/sb)로 하므로 RLS 를 통과한다.
drop policy if exists banners_public_read on public.banners;
create policy banners_public_read on public.banners
  for select to anon, authenticated using (true);

drop policy if exists banner_settings_public_read on public.banner_settings;
create policy banner_settings_public_read on public.banner_settings
  for select to anon, authenticated using (true);

grant select on public.banners         to anon, authenticated;
grant select on public.banner_settings to anon, authenticated;
grant select on public.active_banners  to anon, authenticated;

-- 뷰는 security_invoker 로 둬서 밑에 깔린 테이블의 RLS 를 그대로 탄다
-- (기본값인 definer 로 두면 뷰 소유자 권한으로 읽혀 정책이 무시된다).
alter view public.active_banners set (security_invoker = on);

-- 기존 커뮤니티 toolshere 배너를 데이터로 옮긴다 — 이 행이 생기면 앱 코드의 상수 배너는
-- 지운다(app/components/BoardPromoBanner.tsx). 앞으로는 admin 에서 바꾼다.
insert into public.banners (menu, image_url, target_type, target_value, sort_order, memo)
select 'board',
       'https://sodate-admin.pages.dev/media/promo/toolshere-banner-anim-v3.webp',
       'url',
       -- 언어 없는 루트로 보내면 서버가 로케일 판별로 한 번 더 넘겨 눈에 띄게 느리다
       -- → 처음부터 /ko 로 보낸다(2026-08-20 오너 지시).
       'https://toolshere.app/ko',
       0,
       'Tools Here 자사 홍보(앱 코드에서 이관)'
where not exists (select 1 from public.banners where menu = 'board');
