# 상세 설명 = 이미지 유형(image type) 기반 사양

## 배경
- 앱 이벤트 상세페이지의 "상세 설명"이 크롤 텍스트라 부정확 → 오너가 캡처한 이미지로 대체.
- 단순 "업체당 1세트"로는 부족: 일부 업체는 **일정마다 상세 이미지가 다름**.

## 모델
- **업체(company)마다 "상세 이미지 유형"을 N개 등록**
  - 유형 = { 이름, 이미지 URL 여러 장(세로 스택 순서), 기본 여부, 정렬순서 }
- **각 일정(event)은 어떤 유형을 쓸지 선택**
  - 기본값: 업체의 기본(첫 번째) 유형이 자동 적용 (event.image_type_id = null → 렌더 시 기본 유형으로 해석)
  - 일부 일정만 오너가 admin에서 다른 유형으로 오버라이드

## 표시 우선순위 (앱 상세페이지 "상세 설명")
1. event.image_type_id 지정됨 → 그 유형의 이미지 세로 나열
2. 아니면 → 업체 기본 유형(is_default, 없으면 sort_order 최소)의 이미지
3. 그것도 없으면 → 섹션 통째로 숨김 (크롤 텍스트는 앱에서 완전 미노출)

## DB
```sql
create table company_image_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  images text[] not null default '{}',   -- 세로 스택 순서
  is_default boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on company_image_types(company_id);

alter table events add column image_type_id uuid references company_image_types(id) on delete set null;
```

## Storage
- 공개 버킷 `company-desc`. 경로: `{company_slug}/{type_id}/{순번}.{ext}`
- read: public / insert·update·delete: authenticated(admin)

## Admin
- **/companies**: 업체별 이미지 유형 관리 (유형 추가/삭제/이름수정, 이미지 여러 장 업로드/삭제, 기본 지정)
- **/events**: 일정별 "상세 이미지 유형" 선택 드롭다운 (기본=업체 기본 유형, 변경 가능)

## App
- event/[id] 상세페이지: 위 우선순위대로 이미지 렌더 or 섹션 숨김.

## 상태
- 2026-07-09 사양 확정. 구현 착수.
