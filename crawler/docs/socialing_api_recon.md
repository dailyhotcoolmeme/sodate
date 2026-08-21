# 소셜링 신규 소스 API 정찰 (2026-08-21 실측)

문토는 기존 munto.py 확장(categoryId 취미 9종). 아래는 신규 2소스 실측 결과.

## 트레바리 (놀러가기)
- **목록**: `GET https://product-public-api.trevari.co.kr/api/v1/categories/outgoing/products?eligible=false&page_no={N}&page_size=100`
  - 무인증. `eligible=true`는 400(로그인 필요) → 반드시 `false`.
  - 응답: `{ paging:{currentPage,pageSize,hasNext}, data:[...] }`. hasNext로 페이지네이션.
- **상품 필드** (`data[]`):
  - `id` (str) — 상품 id
  - `name` (str) — 제목. 날짜 포함 예: `[씀에세이-굴튀김] 8/23(일) 모임 놀러가기`
  - `price.total` (int) — 가격(원)
  - `display.thumbnailBadges.topLeft` — **지역** (안국/강남/홍대…)
  - `display.thumbnailBadges.bottomLeft` — **날짜+시간** `"8/23(일) 10:00"` (연도 없음 → 현재연도, 과거면 +1년)
  - `display.thumbnailUrl` — 썸네일
  - `display.link` — `/meetings/show?clubID=...` → **source_url = `https://trevari.co.kr` + link**
  - `display.badges[].text` — 대기 상태 `"지금 신청하면 대기 2번"` → 마감/대기 판단
- **없음**: 남녀 성비, 정확한 정원 숫자(대기 배지로만 마감 표현)
- **볼륨**: ~1,504건. page_size=100, 16페이지.

## 동행클럽 (넷플연가 후신)
- **목록**: `GET https://api.donghaeng.club/v2/nfyg/meetups?type={T}&upcoming=true&limit=32&offset={N}`
  - 무인증. `type` 순회: **1(172), 2(11), 3(2), 5(20)** = upcoming ~205건. type4=0.
  - 응답: `{ success, data:{ meetups:[{meetup:{...}, wishes:[]}], totalCount, pagination:{nextPage} } }`
- **meetup 필드** (`data.meetups[].meetup`):
  - `id` (int), `title` (str)
  - `briefLocation` (str) + `tags.region[]` — **지역** (홍대/강남…)
  - `tags.salonCategory[]` / `tags.salonFilter[]` — **카테고리** (일과 커리어/라이프스타일…) → socialing_category
  - `price` (int), `discountPrice` (int|null)
  - `attendeeCount` / `maxCapacity` — 정원·마감 판단
  - `femaleCapacity`/`femaleCount`/`maleCapacity`/`maleCount` — **성비**(스키마 존재, 대개 null. 채워진 모임엔 값)
  - `closingDate` (ISO|null) — 신청 마감
  - `sessions[].date` (ISO) — **실제 모임 날짜**. 다회차 시즌모임이라 여러 세션 → **첫 세션 date 대표**. `sessions[].place.thumbnailUrl` 이미지.
  - `thumbnailUrl` (대개 null → sessions/contents 이미지 사용)
- **주의**: 동행클럽은 "시즌제 다회차 프로그램"(주1회 4~7주)이라 문토/트레바리의 단일 회차와 성격 약간 다름. 가격도 시즌 전체(20만원대)라 회당 아님. → 대표 날짜=첫 세션, 가격은 그대로 표기.
- **아웃링크**: `https://donghaeng.club/meetups/{id}` (실측 200 확인).

## 공통 설계
- 전부 `event_type='socialing'`, `socialing_category`=소스별 카테고리명.
- `source`/company_id로 출처 구분(트레바리·동행클럽 companies 신규 등록 필요).
- 성비 없는 소스(트레바리) → 카드는 총 정원/대기만.
- base_scraper의 소개팅 전제(theme 고정, 10~21시 시간대 필터)는 event_type='socialing'에 우회 필요.
