-- 분석 기록에 '메뉴'와 '앱 버전'을 남긴다 — 2026-09-03 오너 지시(메뉴별 대시보드)
--
-- 왜 컬럼으로 빼나 —
--  1) 지금은 어느 메뉴에서 일어난 일인지 알 방법이 일정 번호(event_id)로 events 를 되짚는
--     것뿐인데, 지난 일정은 지워진다. 그래서 최근 60일 행동 기록의 **89%가 어느 메뉴인지
--     모르는 상태**다(2026-09-03 확인: 1,939건 중 1,723건). 기록할 때 메뉴를 같이 적으면
--     내용이 지워져도 안 깨진다.
--  2) properties(jsonb) 안에 넣어도 되지만, 메뉴별 집계는 대시보드에서 늘 쓰는 축이라
--     컬럼으로 두고 인덱스를 건다.
--
-- app_version 은 OTA 도달률 확인용이다. 지금은 배포하고도 몇 %가 새 버전을 받았는지
-- 볼 방법이 없다.

alter table public.analytics_events add column if not exists menu text;
alter table public.analytics_events add column if not exists app_version text;

comment on column public.analytics_events.menu is
  '소개팅(dating)·소셜링(socialing)·혼술바(honsul)·커뮤니티(board) 중 어디서 일어난 일인지.
   전역 동작(앱 실행 등)은 null.';
comment on column public.analytics_events.app_version is
  '기록 당시 앱 버전. OTA 가 실제로 몇 %에 닿았는지 보는 용도.';

-- 대시보드 질의는 늘 "최근 N일 + 메뉴별"이라 이 순서로 건다.
create index if not exists analytics_events_menu_created_idx
  on public.analytics_events (menu, created_at desc);

-- 검색어·필터 순위는 properties 안을 뒤진다. 종류로 먼저 좁히므로 이 인덱스면 충분하다.
create index if not exists analytics_events_type_created_idx
  on public.analytics_events (event_type, created_at desc);
