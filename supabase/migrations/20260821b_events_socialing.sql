-- 소셜링 확장(2026-08-21) — events 테이블에 소개팅/소셜링을 구분하는 컬럼 추가.
--
-- 소셜링은 소개팅과 데이터 구조가 동일해(남녀 인원·가격·마감·날짜·지역) 같은 테이블을
-- 쓴다. event_type 으로 나누고, 소셜링은 세부 카테고리(러닝·독서·컨셉파티…)를 담는다.
--
-- ⚠️ 기존 데이터는 전부 소개팅이므로 default 'dating'. 소개팅 피드(useEvents)는
--    event_type='dating' 로 걸러 소셜링이 섞이지 않게 한다(앱에서 처리).

alter table public.events
  add column if not exists event_type text not null default 'dating',
  add column if not exists socialing_category text;

comment on column public.events.event_type is
  '이벤트 종류: dating(소개팅, 기본) | socialing(취미 소셜링). 앱 탭이 이걸로 나뉜다.';
comment on column public.events.socialing_category is
  '소셜링 세부 카테고리(러닝·독서·컨셉파티·맛집투어 등). event_type=socialing 일 때만 채워진다.';

-- 소개팅 피드는 항상 event_type + is_active + 날짜로 좁히므로 복합 인덱스를 건다.
create index if not exists idx_events_type_date
  on public.events (event_type, event_date) where is_active;

-- 새 컬럼 권한 — board_posts 때 컬럼권한 누락으로 조회가 막힌 사고(2026-08-21)를 반복하지 않는다.
-- events 도 컬럼별 GRANT 인지 확인 후 기존 컬럼과 동일하게 부여한다.
grant select (event_type, socialing_category) on public.events to anon, authenticated;
