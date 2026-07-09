-- 상세 설명 = 이미지 유형(image type) 기반
-- 업체마다 상세 이미지 유형을 N개 등록, 각 일정은 유형을 선택(기본=업체 기본 유형)

create table if not exists company_image_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  images text[] not null default '{}',        -- 세로 스택 순서
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_company_image_types_company on company_image_types(company_id);

alter table events
  add column if not exists image_type_id uuid references company_image_types(id) on delete set null;

-- RLS: 공개 읽기(앱), 쓰기는 서비스/인증 관리자만
alter table company_image_types enable row level security;

drop policy if exists cit_public_read on company_image_types;
create policy cit_public_read on company_image_types
  for select using (true);
