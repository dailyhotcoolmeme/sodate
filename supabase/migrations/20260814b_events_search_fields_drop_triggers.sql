-- 긴급 롤백(2026-08-14): 20260814_events_search_fields.sql이 추가한 트리거가 크롤러의
-- 대량 이벤트 upsert와 겹치면서 DB 리소스를 고갈시켜 전체 API(모임 피드+커뮤니티 둘 다)가
-- 멈추는 사고로 이어졌다. hashtags_search·company_name 컬럼 자체는 유지(기존 값으로 검색은
-- 계속 동작)하되, 매 행마다 추가 쿼리를 실행하는 트리거만 제거한다.
--
-- ⚠️ 이후 크롤러가 새로 넣는 이벤트는 이 두 컬럼이 비어있게 된다 — 검색에서 빠진다는
-- 뜻. 트리거 대신 저부하 배치(예: 크롤러 자체에서 채우기, 또는 낮은 빈도 스케줄)로
-- 다시 채우는 방법을 다음에 붙일 것.
drop trigger if exists trg_sync_event_search_fields on events;
drop trigger if exists trg_cascade_company_name on companies;
