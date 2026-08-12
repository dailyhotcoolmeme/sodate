-- 2026-08-11: date_start/date_end를 alert_subscriptions(알림 설정)에 추가했다가,
-- 오너 지시로 스코프가 "검색 필터"로 재조정되어(알림설정이 아님) 되돌린다.
-- (날짜 범위 필터는 filterStore의 dateStart/dateEnd로 구현 — 알림 구독과 무관)
alter table public.alert_subscriptions
  drop column if exists date_start,
  drop column if exists date_end;
