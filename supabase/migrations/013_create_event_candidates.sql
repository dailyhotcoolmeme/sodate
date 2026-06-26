-- event_candidates — 크롤러가 발견한 '예정 날짜 + 확인링크' 후보.
-- 정확성 책임 없음(좌석·가격은 admin에서 오너가 입력). admin 등록 화면이 이 테이블을 읽어 자동 리스트업.
create table if not exists public.event_candidates (
  id              uuid default gen_random_uuid() primary key,
  company_id      uuid references public.companies(id) on delete cascade not null,
  event_datetime  timestamptz not null,        -- 예정 모임 일시
  link            text not null,               -- 확인용 아웃링크 (실제 모임/신청 페이지)
  title           text,                        -- 참고용 제목(자동)
  location_region text,                        -- 참고용 지역(자동)
  price_male      integer,                     -- prefill(선택) — 정답 아님
  price_female    integer,                     -- prefill(선택)
  source          text default 'crawl',        -- 'crawl' | 'manual'
  registered      boolean default false,       -- events 로 등록 완료됐는지
  discovered_at   timestamptz default now(),
  unique (company_id, event_datetime, link)
);

create index if not exists event_candidates_company_idx on public.event_candidates(company_id);
create index if not exists event_candidates_datetime_idx on public.event_candidates(event_datetime);
create index if not exists event_candidates_registered_idx on public.event_candidates(registered);

-- events 에 출처 구분 추가 (크롤링 데이터 무시/수동 구분용)
alter table public.events add column if not exists source text default 'manual';
