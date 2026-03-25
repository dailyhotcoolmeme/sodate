-- events 테이블에 나이대 그룹 라벨 및 참가자 현황 컬럼 추가
alter table public.events
  add column if not exists age_group_label text,
  add column if not exists participant_stats jsonb default '{}';

comment on column public.events.age_group_label is '나이대 그룹 라벨 (예: A그룹(03~98년생), 2030, 95-02년생)';
comment on column public.events.participant_stats is '참가자 현황 JSON {"male": [{"birth_year": 93, "job": "공무원", "height": 178}], "female": [...], "seats_left_male": 2, "seats_left_female": 3}';

-- 인덱스 (나이대 그룹으로 필터링)
create index if not exists events_age_group_label_idx on public.events(age_group_label);

-- seolrem1.com = 2yeonsi.com 동일 사이트 → 비활성화
update public.companies set is_active = false where slug = 'seolrem';
