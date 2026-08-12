-- 참석자 명단 이미지(일정별 고유, R2 재호스팅) — 노션 등 원본 소스 링크는 만료되므로
-- 크롤링 시 다운받아 R2에 재업로드한 뒤 이 컬럼에 공개 URL을 저장한다.
-- thumbnail_urls(배열)에 얹지 않는 이유: 앱 어디서도 [0] 외엔 렌더링하지 않고,
-- 삭제 대상(지난 일정 정리)을 명확히 특정하려면 전용 컬럼이 안전하다.
alter table public.events
  add column if not exists attendee_image_url text;

comment on column public.events.attendee_image_url is
  '참석자 명단 이미지(R2 공개 URL). 일정 종료 후 크롤러가 R2 원본 삭제 + 이 값 null 처리.';
