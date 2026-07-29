-- 상세 이미지 유형에 해시태그 추가 (2026-07-29 오너 요청)
-- 유형에 매칭된 모임은 이 해시태그를 표시하고(오너 큐레이션),
-- 매칭 안 됐거나 유형에 태그가 비어 있으면 크롤러 자동 생성 태그를 그대로 쓴다.
alter table company_image_types
  add column if not exists hashtags text[] not null default '{}';
