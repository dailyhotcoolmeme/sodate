# 사용자 후기 기능 (로그인 없는 UGC) — 스펙

작성: 2026-07 / 상태: 착수

## 확정 사양 (오너)
- **대상**: 업체별(company_id) — 기존 크롤 후기와 동일 테이블·단위
- **소유권(수정/삭제)**: 익명 기기 시크릿(UUID) — 첫 작성 시 SecureStore에 생성·저장, 후기 행에 토큰(해시) 저장. 수정/삭제 시 토큰 일치해야 허용. 앱삭제/기기변경 시 그 권한 상실(후기 특성상 허용).
- **사진 첨부**: MVP 제외 (별점 + 텍스트 + 닉네임)
- **공존**: `source`로 구분 — naver/instagram=크롤, `user`=직접. 직접 후기엔 "직접 작성" 배지 + 본인만 수정/삭제.

## ⚠️ 출시 필수 (UGC 컴플라이언스 — 옵션 아님)
Apple 가이드라인 1.2 / Google UGC 정책상 아래 없으면 심사 반려:
1. **비속어/부적절 필터** — 작성 시 서버(Edge Function)에서 금지어 검사
2. **신고(report)** 기능 — 후기 신고 → reports 집계
3. **차단/자동숨김** — 신고 N회(예: 3회) 시 is_active=false 자동 블라인드. 기기 토큰 단위 차단.
4. **약관 무관용 조항 + 24h 내 조치** 문구

### 개인정보처리방침 개정 (필수)
- 현재 "개인 식별정보 수집 안 함" → **닉네임·후기내용·후기토큰** 수집 항목/목적/보유기간 추가.
- 닉네임은 자유 닉네임(실명 아님)으로 받아 최소화.

### 이용약관 UGC 조항 추가 (필수)
- 게시물 이용자 책임, 금지 콘텐츠(명예훼손/음란/허위/광고), 회사 삭제·블라인드 권한, 신고 처리, 저작권 이용허락, 면책.

## 기술 설계
### DB (reviews 테이블 확장)
- 추가 컬럼: `owner_token text`(해시 저장), `report_count int default 0`, `user_nickname`(author_name 재사용 가능), `rating`(기존), `content`(기존), `source='user'`.
- 신고: `review_reports(review_id, reporter_token, created_at)` 신규 테이블 + 트리거로 report_count 갱신, 3회 시 is_active=false.
- RLS: reviews insert/select는 anon 허용(검증은 Edge Function), 직접 update/delete 차단 → Edge Function 경유.

### Edge Function (또는 서버 프록시)
- `submit-review`: 검증(닉네임·별점·내용 필수, 길이, 비속어 필터, 기기당 업체별 1회 제한) → insert.
- `update-review`/`delete-review`: owner_token 일치 검증 후 처리.
- `report-review`: reporter_token 기록, 자동숨김 트리거.

### 앱
- 기기 시크릿: expo-secure-store(`review_token`) — 없으면 생성.
- 상세페이지 후기 섹션: "후기 작성" 버튼 → 바텀시트(닉네임·별점·내용). 본인 후기엔 수정/삭제. 각 후기에 신고(⋯) 메뉴.
- 크롤 후기 vs 직접 후기: "직접 작성" 배지, 정렬(직접 후기 우선 or 최신순).

### admin
- 후기 모더레이션 탭(신고된 후기 목록, 블라인드/복구).

## 진행 순서
1. DB 스키마(컬럼·reports 테이블·트리거) + RLS
2. Edge Functions (submit/update/delete/report)
3. 앱 UI (작성 바텀시트·수정삭제·신고·직접후기 표시)
4. 개인정보처리방침·약관 개정
5. admin 후기 모더레이션
