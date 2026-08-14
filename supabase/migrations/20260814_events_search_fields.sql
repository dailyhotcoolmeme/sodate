-- 모임 피드 톱바 검색(2026-08-14 오너 지시): 모임명(title) + 해시태그 + 업체명 + 지역으로 검색.
--
-- hashtags는 배열이라 PostgREST ilike로 부분일치가 안 된다(cs는 완전일치만 지원) —
-- 문자열로 합쳐둔 컬럼을 만들어 우회한다. GENERATED ALWAYS로 만들려 했으나
-- array_to_string()이 IMMUTABLE이 아니라(STABLE) 거부됨(실측: "generation expression
-- is not immutable") — 트리거로 직접 채운다. 활성 이벤트가 1,100건 안팎이라
-- 인덱스 없이도 충분히 빠르다.
--
-- 업체명(companies.name)은 조인 테이블 컬럼이라 PostgREST or() 로직트리 안에서 직접
-- 필터링이 안 된다(실측 확인: "companies.name.ilike...."를 or()에 넣으면 PGRST100
-- 파싱 에러). events에 업체명을 동기화해두는 트리거 컬럼으로 같이 우회.
alter table events
  add column if not exists hashtags_search text,
  add column if not exists company_name text;

update events e set
  hashtags_search = array_to_string(e.hashtags, ' '),
  company_name = c.name
  from companies c
  where c.id = e.company_id;

create or replace function sync_event_search_fields() returns trigger as $$
begin
  new.hashtags_search := array_to_string(new.hashtags, ' ');
  select name into new.company_name from companies where id = new.company_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_event_search_fields on events;
create trigger trg_sync_event_search_fields
  before insert or update of hashtags, company_id on events
  for each row execute function sync_event_search_fields();

-- 업체명이 바뀌는 일은 드물지만(리브랜딩 등), 바뀌면 이미 저장된 이벤트에도 반영.
create or replace function cascade_company_name_to_events() returns trigger as $$
begin
  if new.name is distinct from old.name then
    update events set company_name = new.name where company_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cascade_company_name on companies;
create trigger trg_cascade_company_name
  after update of name on companies
  for each row execute function cascade_company_name_to_events();

-- ⚠️ board_posts는 컬럼 단위 GRANT라 새 컬럼을 깜빡하고 안 걸어줘서 목록 전체가
-- 안 보인 사고가 있었다(20260813e_board_link_urls_grant.sql). events는 테이블 단위
-- GRANT라 새 컬럼이 자동으로 anon/authenticated에 노출되지만, 혹시 몰라 명시해둔다.
grant select (hashtags_search, company_name) on events to anon, authenticated;
