# AGENTS.md — 에이전트 전체 정의 및 인터페이스

## 에이전트 구조 개요

```
PM (Orchestrator)
├── Phase 1 (병렬)
│   ├── ARCH  — 아키텍처/환경 세팅
│   └── DB    — 데이터베이스 세팅
├── Phase 2 (병렬, Phase 1 완료 후)
│   ├── CRAWLER — 크롤러 개발
│   ├── APP     — 앱 개발
│   └── PUSH    — 푸시 알림 개발
├── Phase 3 (병렬, 각 기능 완료 즉시)
│   ├── QA  — 테스트/검증
│   └── SEC — 보안 검토
└── Phase 4 (전체 완료 후, 상시)
    └── MONITOR — 운영 모니터링
```

---

## 에이전트별 상세 정의

### 0. PM (Project Manager)
- **파일**: `CLAUDE.md` (루트)
- **역할**: 전체 작업 분해 및 서브 에이전트 조율
- **권한**: 모든 에이전트에 지시 가능
- **책임**: 최종 결과물 품질 보증

---

### 1. ARCH (Architecture Agent)
- **파일**: `agents/ARCH.md`
- **Phase**: 1 (가장 먼저 실행)
- **산출물**:
  - 전체 폴더 구조 생성
  - 의존성 설치 (`package.json`, `requirements.txt`)
  - `.env.example` 파일
  - `tsconfig.json`, ESLint, Prettier 설정
  - GitHub Actions 기본 워크플로우 파일
- **DoD**: 폴더구조 생성 완료 + `npx expo start` 에러 없이 실행

---

### 2. DB (Database Agent)
- **파일**: `agents/DB.md`
- **Phase**: 1 (ARCH와 병렬)
- **산출물**:
  - Supabase 마이그레이션 SQL 파일
  - RLS 정책
  - pgmq Queue 생성
  - Edge Function 스켈레톤
  - DB 타입 자동생성 (`supabase gen types`)
- **DoD**: 모든 테이블 생성 확인 + RLS 적용 + pgmq 동작 확인

---

### 3. CRAWLER (Crawler Agent)
- **파일**: `agents/CRAWLER.md`
- **Phase**: 2
- **의존성**: ARCH 완료 (폴더구조), DB 완료 (테이블)
- **산출물**:
  - 업체별 스크래퍼 파일 (`scrapers/lovematching.py` 등)
  - 공통 유틸리티 (`utils/supabase_client.py`, `utils/logger.py`)
  - 메인 실행 파일 (`main.py`)
  - GitHub Actions 스케줄 워크플로우
- **DoD**: 최소 3개 업체 크롤링 성공 + Supabase 저장 확인 + 중복없음

---

### 4. APP (App Agent)
- **파일**: `agents/APP.md`
- **Phase**: 2 (CRAWLER와 병렬)
- **의존성**: ARCH 완료, DB 완료
- **산출물**:
  - 모든 화면 컴포넌트
  - 네비게이션 구조
  - Supabase 데이터 연동
  - 필터/검색 기능
  - 아웃링크 처리
  - UI 컴포넌트 라이브러리
- **DoD**: 모든 화면 렌더링 + 필터 동작 + 아웃링크 동작 + iOS/Android 빌드 성공

---

### 5. PUSH (Push Notification Agent)
- **파일**: `agents/PUSH.md`
- **Phase**: 2 (APP, CRAWLER와 병렬)
- **의존성**: DB 완료 (pgmq Queue)
- **산출물**:
  - Expo Notifications 앱 내 세팅
  - 토큰 등록/관리 로직
  - `match-subscriptions` Edge Function
  - `process-push-queue` Edge Function
  - 알림 설정 화면 (APP 에이전트와 인터페이스)
- **DoD**: 토큰 등록 → 새 이벤트 → Queue 적재 → 푸시 수신 end-to-end 성공

---

### 6. QA (Quality Assurance Agent)
- **파일**: `agents/QA.md`
- **Phase**: 3 (각 기능 완료 즉시 병렬 실행)
- **산출물**:
  - 크롤러 유닛 테스트
  - DB 마이그레이션 테스트
  - 앱 컴포넌트 테스트
  - E2E 테스트 시나리오
  - 테스트 결과 리포트
- **DoD**: 전체 테스트 통과 + 커버리지 리포트 생성

---

### 7. SEC (Security Agent)
- **파일**: `agents/SEC.md`
- **Phase**: 3 (QA와 병렬)
- **산출물**:
  - RLS 우회 시도 테스트
  - API 키 노출 검사
  - 크롤러 보안 검토
  - 보안 체크리스트 완료 보고서
- **DoD**: 알려진 취약점 0건 + API키 노출 0건

---

### 8. MONITOR (Monitoring Agent)
- **파일**: `agents/MONITOR.md`
- **Phase**: 4 (배포 후 상시)
- **산출물**:
  - GitHub Actions 크롤링 성공률 알림
  - Supabase 대시보드 쿼리
  - 이상 감지 시 알림 채널 설정
- **DoD**: 모니터링 대시보드 동작 + 알림 채널 연결 확인

---

## 에이전트 간 인터페이스

### ARCH → 나머지 모든 에이전트
```
제공: 폴더구조, tsconfig, 환경변수 템플릿
```

### DB → CRAWLER, APP, PUSH
```
제공: Supabase URL/Key, 타입 정의 파일 (database.types.ts)
     테이블 구조, RLS 정책
```

### CRAWLER → DB
```
호출: events 테이블 upsert
      crawl_logs 테이블 insert
      companies 테이블 read
```

### APP → DB
```
호출: events 테이블 read (RLS anon)
      companies 테이블 read
      push_tokens 테이블 write (service role)
      alert_subscriptions 테이블 write
```

### PUSH → DB
```
호출: pgmq push_notifications Queue read/write
      push_tokens 테이블 write
      alert_subscriptions 테이블 read
```

### QA → 모든 기능 에이전트
```
검증: 각 에이전트 산출물 DoD 기준 테스트
```

### SEC → 모든 기능 에이전트
```
검증: API키 노출, RLS 우회, 인젝션 취약점
```

---

## 에러 처리 원칙

```
각 에이전트는 작업 실패 시:
1. 에러 메시지와 스택트레이스를 PM에게 보고
2. 재시도 가능한 경우 최대 3회 재시도
3. 재시도 실패 시 PM이 해결책 결정
4. 다른 에이전트 작업에 블로킹이 발생하면 PM이 순서 재조정
```
