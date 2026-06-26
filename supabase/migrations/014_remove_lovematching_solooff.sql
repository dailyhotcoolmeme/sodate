-- 014_remove_lovematching_solooff.sql
-- 러브매칭(lovematching) / 솔로오프(solo-off) 제거.
-- 사유: 일정이 사이트에 노출되지 않고 '신청/구매 후 매니저가 별도 안내'하는 형태라
--       수동입력(관리자 등록)으로도 일정을 확보할 수 없어 서비스에서 제외.
-- 멱등: 재실행해도 안전. events → companies 순으로 삭제.

DELETE FROM events
WHERE company_id IN (
  SELECT id FROM companies WHERE slug IN ('lovematching', 'solo-off')
);

DELETE FROM companies
WHERE slug IN ('lovematching', 'solo-off');
