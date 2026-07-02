# 해시태그 기능 + 크롤러 데이터 정확도 수정 (스펙)

작성: 2026-07 / 상태: 착수

## 배경 — 스크래퍼 전수 감사 결과 (확정된 근본 원인)

### 공용 저장 로직 `crawler/scrapers/base_scraper.py`
- `line 60`: `data['theme'] = ['소개팅']` — **모든 스크래퍼의 theme을 저장 직전 일괄 덮어씀**. DB의 와인/쿠킹/결혼 등은 이 코드 이전의 레거시.
- `line 52~57`: 정원/잔여석/가격 **항상 None** (관리자 직접 입력 전용).
- `line 64~66`: tzinfo 없는 datetime은 **KST로 간주** 후 UTC 변환.
- `line 99`: `upsert(data, on_conflict='source_url')` — 중복 판정은 **source_url 문자열 완전일치**에만 의존. external_id 컬럼 있으나 munto만 채우고 dedup엔 미사용.

### 문제 1) 괜찮소(yeongyul.py) 중복 저장
- 원인: `yeongyul.py:59-62`가 게시글 href를 원본 그대로 수집. `new Set`은 완전일치만 제거 → PC/모바일·쿼리스트링 변형 href가 서로 다른 source_url로 살아남아 **2행 insert**.
- 수정: href에서 게시글 고유번호(`ab-\d+-\d+`)만 추출해 **정규화 URL을 source_url 키로** 사용. 불필요한 `#evt=` 접미어 제거.

### 문제 2) 문토(munto.py) 시간 -9시간
- 원인: `munto.py:325` `.astimezone().replace(tzinfo=None)` → 실행 머신 TZ 의존. GitHub Actions(UTC)에서 naive UTC 생성 → base_scraper가 또 KST로 간주 → **-9h**.
- 수정: 문토에서 **명시적 KST 변환**(`.astimezone(KST)`) 후 넘김. (naive=KST 전제와 일치시킴)

### 문제 3) 지역 "서울" 뭉뚱그림
- 주범: 에모셔널오렌지(61)·연인어때(22)·토크블라썸(19). 세부 동네 원천을 안 쓰거나(EO 블로그 location 미사용) 미매칭 시 '서울' 폴백.
- 수정: 원천 있는 곳에서 동네 추출 + `REGION_MAP`에 성수/종로/신촌 등 확장. 태생적 원천 없는 건 **admin에서 직접 교정**.

### 문제 4) (보너스) 날짜 필터 TZ 불일치
- `is_within_one_month`(naive=UTC) vs `save_events`(naive=KST) → 경계일 이벤트 9h 어긋나 누락 가능.
- 수정: naive 해석 기준을 KST로 통일.

## 결정 사항 (오너 확정)

1. **해시태그 = 크롤러가 1차 자동 생성 → admin에서 검수·수정** (하이브리드)
2. **저장 = 새 `hashtags text[]` 컬럼 신설** (theme은 레거시로 방치)
3. **기존 DB 데이터도 정리** (괜찮소 중복 삭제 + 문토 +9h 보정 + 기존 이벤트 해시태그 일괄 backfill)
4. 진단 수정 + 해시태그 기능 **병렬 진행**

## 해시태그 설계

### 시작 사전 (admin에서 계속 편집 가능)
- 컨셉: `#와인` `#요리` `#보드게임` `#등산·아웃도어` `#전시·문화` `#가치관팅` `#사주·타로` `#독서`
- 형식: `#1:1` `#소규모` `#로테이션` `#커피미팅` `#식사모임` `#사회자진행`
- 대상: `#직장인` `#전문직` `#20대` `#30대` `#40대`

### 자동 생성 (crawler 공통 유틸)
- 스크래퍼별 분산 로직 대신 **`crawler/utils/hashtags.py` 공통 유틸 1개**에서
  `제목 + 본문(description) + 지역 + age_range + (토크블라썸 등 공식 옵션값)`을
  **정규화 사전**에 매핑 → 이벤트당 3~4개 태그.
- `base_scraper`가 hashtags는 **덮어쓰지 않고 그대로 저장**.

### 구현 범위 (4곳)
1. **앱 카드/상세**: 소개팅명 밑 배지 3개 내외 표시.
2. **배지 탭 → 필터**: 해당 해시태그로 즉시 필터링.
3. **필터 페이지**: 해시태그 검색/선택 UI.
4. **admin**: 모임별 해시태그 표시 + 편집·저장.

## 실행 순서
- [완료] WS1 DB: `hashtags text[]` 컬럼 + GIN 인덱스 추가
- [완료·미푸시] WS2 크롤러: 괜찮소 canonical dedup, 문토 KST, date_filter TZ 통일, 지역 세부화, hashtags 유틸 + base 보존. **GitHub push 필요(대기)**
- [완료·OTA배포] WS3 앱: HashtagChips 배지 + 탭 필터 + FilterSheet 태그검색 + filterStore(overlaps OR). iOS/Android OTA 완료
- [완료·미배포] WS4 admin: Events.tsx 표시·편집. **CF Pages 배포 필요(대기)**
- WS5 데이터 정리: [완료] 괜찮소 중복 19행 삭제 · [완료] 기존 349건 중 342건 hashtags backfill · [대기] 문토 시간=재크롤로 보정(일괄 +9h는 시간 혼재로 위험, SQL 금지)

## 후속 메모
- 자동 해시태그가 #로테이션/연령대 위주로 밋밋. 컨셉태그(#와인/#사주) 희소 → admin 큐레이션 또는 derive에서 #로테이션 제외 검토.
- 문토 재크롤은 크롤러 push 후 GitHub Actions 실행 필요.
