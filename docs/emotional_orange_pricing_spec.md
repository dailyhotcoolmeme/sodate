# 에모셔널오렌지 가격/연령 자동 크롤링 + 티어 표시 사양

작성 2026-07-07. 오너 확정.

## 배경
- 에모셔널오렌지(감정적인 오렌지들, emotional0ranges.com)는 전체 이벤트 중 대부분을 차지 → admin 수동입력 부담이 큼.
- **월단위 배치**로 일정이 한 번에 뜸(확인됨: "7월 프로그램" 전체가 한꺼번에 노출). imweb 기반.
- 나머지 업체는 건수가 적어 오너가 수동 입력. **이 자동화는 에모셔널오렌지 전용.**

## 데이터 구조(사이트 실측)
- imweb 상품(=지역)마다 `load_option.cm`으로 **1차 옵션(일시)** = `"7월 7일 화요일 저녁 8시 (나이E)"` 형태. 날짜+시간+**남성 나이코드**가 라벨에 박힘.
- 날짜를 고르면 **2차 옵션(지역+성별)**이 AJAX로 로딩. 여기 **성별 가격**이 있음. 요청:
  ```
  POST /shop/load_option.cm
  type=prod&prod_idx=<idx>
  &selected_require_options[0][value_type]=SELECT
  &selected_require_options[0][option_code]=<1차그룹hash>
  &selected_require_options[0][value_code]=<선택한 날짜 value hash>
  ```
- **가격은 날짜마다 다름**(예 송파문정 7/7 남31,000 / 7/8 남55,000). → **날짜마다 2차 옵션 조회 필수.**
- 성별 옵션에 **정가 + 얼리버드(할인, 자주 품절)** 티어 존재. 예:
  | 날짜 | 남정가 | 남얼리버드 | 여정가 | 여얼리버드 |
  |---|---|---|---|---|
  | 7/7(E) | 31,000 | — | 19,000 | — |
  | 7/15(B) | 55,000 | 45,000 | 38,000 | 28,000 |
- 각 티어에 `(품절)` 표시 있음 → 마감 여부 파싱 가능(잔여 개수는 아님).
- **남성 가격 > 여성 가격** 항상 성립(오너 확인).
- 목록 텍스트의 28,000/38,000은 **표시용 더미**라 신뢰 금지. 실제가는 2차 옵션.

## 나이코드 → 남성 연령 (티키타카 기준, /date는 전부 티키타카)
A 23-28, B 26-31, C 29-34, D 32-37, E 35-40, F 38-43, G 41-49.
(기존 `scrapers/emotional_orange.py` AGE_CODE_MAP과 동일. 블랙라운지·돌싱은 표가 다르나 /date엔 안 뜸 → 대상 아님.)
여성은 **연령 무관**(사이트 명시).

## 저장 모델
기존 `events.price_male`/`price_female`(정가)는 그대로 유지(목록·필터·정렬·타 업체 공용).
**신규 컬럼 `events.price_detail jsonb` (nullable)** 추가:
```json
{
  "male":   { "regular": 55000, "earlybird": 45000, "earlybird_soldout": true },
  "female": { "regular": 38000, "earlybird": 28000, "earlybird_soldout": false }
}
```
- `earlybird`/`earlybird_soldout`는 티어 있을 때만. 없으면 `regular`만(7/7처럼).
- `regular`는 `price_male`/`price_female`에도 미러링.

## 표시 규칙(앱 상세)
- `price_detail` 있으면 티어 표시, 없으면 기존 단일가.
- **얼리버드 품절이면 그 "가격+(품절)" 글자에 취소선(strikethrough).**
- 목록/카드는 정가(price_male/female)만 — 티어는 상세에서만.

## 변경 범위
1. DB: `price_detail jsonb` 컬럼.
2. 크롤러: `discover_candidates.py` 에모셔널오렌지 전용 enrich(2차 옵션 티어 파싱).
3. 앱: `event/[id].tsx` 상세 가격 렌더(취소선). 카드/목록은 정가 유지.
4. admin: `Register.tsx` price_detail 있으면 티어 읽기표시(에모셔널오렌지 자동, 수동업체는 미사용).

## 제약
- 품절 상태는 크롤 주기(하루)만큼 지연 — 실시간 아님.
