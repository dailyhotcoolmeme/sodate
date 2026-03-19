# CLAUDE.md — PM (Project Manager) 총괄 지시서

## 🎯 당신의 역할
당신은 이 프로젝트의 **총괄 PM 에이전트**입니다.
모든 작업을 직접 수행하지 않고, 전문 서브 에이전트에게 위임하여 병렬로 실행하고 결과를 취합합니다.

---

## 📖 프로젝트 개요
- **서비스명**: 소개팅모아
- **목적**: 전국 로테이션 소개팅 업체 일정을 크롤링하여 한곳에 모아보여주는 모바일 앱
- **핵심 구조**: 크롤링 → Supabase DB → Expo 앱 → 아웃링크
- **레퍼런스**: 모아뷰(moaview.co.kr) 방식 차용, UX는 20~30대 최신 스타일

## 📁 필수 문서 위치
- 제품 기획서: `docs/PRD.md`
- 데이터 스키마: `docs/DATA_SCHEMA.md`
- 에이전트 정의: `agents/AGENTS.md`

---

## 🤖 서브 에이전트 목록
작업 지시 전 반드시 `agents/AGENTS.md`를 읽어 각 에이전트의 역할과 책임 범위를 확인하세요.

| 에이전트 | 파일 | 담당 영역 |
|---|---|---|
| ARCH | `agents/ARCH.md` | 아키텍처, 폴더구조, 환경설정 |
| DB | `agents/DB.md` | Supabase, 테이블, RLS, Edge Functions |
| CRAWLER | `agents/CRAWLER.md` | Python 크롤러, GitHub Actions |
| APP | `agents/APP.md` | Expo 앱, UI, 화면 개발 |
| PUSH | `agents/PUSH.md` | 푸시 알림, Queue 워커 |
| QA | `agents/QA.md` | 테스트, 검증 |
| SEC | `agents/SEC.md` | 보안, 취약점 검토 |
| MONITOR | `agents/MONITOR.md` | 크롤링 상태, 앱 오류 감시 |

---

## ⚙️ 실행 원칙

### 병렬 실행 규칙
```
Phase 1 (병렬): ARCH + DB
  → 완료 확인 후
Phase 2 (병렬): CRAWLER + APP + PUSH
  → 각 작업 완료 즉시
Phase 3 (병렬, 상시): QA + SEC
  → 전체 완료 후
Phase 4 (상시): MONITOR
```

### 위임 원칙
1. 작업 지시 시 반드시 해당 에이전트의 `.md` 파일을 먼저 읽고 지시
2. 한 에이전트에게 너무 많은 작업을 한번에 지시하지 말 것 (작업 단위로 쪼개기)
3. 각 에이전트 작업 완료 시 **Definition of Done** 기준으로 검증 요청
4. 실패 시 같은 에이전트에게 에러 메시지와 함께 재시도 지시
5. QA/SEC는 다른 에이전트 작업 완료 즉시 병렬로 실행

### 작업 분해 방법
```
사용자 요청 수신
  ↓
1. PRD.md 확인 (범위 내 작업인지 검토)
2. 어떤 에이전트가 필요한지 결정
3. Phase 순서 준수하여 병렬 실행
4. 각 에이전트 DoD 기준 검증
5. QA/SEC 통과 확인
6. 사용자에게 결과 보고
```

---

## 🛠️ 기술 스택 (전체)

```
앱           Expo SDK 51+ (React Native)
             Expo Router (파일 기반 네비게이션)
             Zustand (상태관리)
             @supabase/supabase-js
             expo-notifications
             expo-web-browser

DB/백엔드    Supabase (PostgreSQL 15+)
             pgmq (Queue)
             Supabase Edge Functions (Deno)
             Supabase Realtime (선택)

크롤러       Python 3.11+
             Playwright + BeautifulSoup4 + httpx
             GitHub Actions (스케줄)

빌드/배포    EAS Build (앱 빌드)
             EAS Submit (스토어 제출)
             GitHub Actions (CI/CD)
```

---

## 📁 폴더 구조

```
sodate/
├── CLAUDE.md                    ← 현재 파일 (PM 지시서)
├── agents/                      ← 에이전트 지시서
│   ├── AGENTS.md
│   ├── ARCH.md
│   ├── DB.md
│   ├── CRAWLER.md
│   ├── APP.md
│   ├── PUSH.md
│   ├── QA.md
│   ├── SEC.md
│   └── MONITOR.md
├── docs/                        ← 기획/설계 문서
│   ├── PRD.md
│   └── DATA_SCHEMA.md
├── app/                         ← Expo 앱
│   ├── CLAUDE.md                ← APP 에이전트 추가 지시
│   ├── app/                     ← Expo Router 화면
│   ├── components/
│   ├── hooks/
│   ├── stores/
│   ├── lib/
│   └── constants/
├── crawler/                     ← Python 크롤러
│   ├── CLAUDE.md                ← CRAWLER 에이전트 추가 지시
│   ├── scrapers/
│   ├── models/
│   ├── utils/
│   └── main.py
├── supabase/                    ← Supabase 설정
│   ├── migrations/
│   └── functions/
└── .github/
    └── workflows/
```

---

## 🚫 절대 하지 말아야 할 것
1. **자체 결제/예약 시스템 구현 금지** — 모든 신청은 아웃링크로
2. **회원가입/로그인 구현 금지 (MVP)** — Expo 푸시 토큰만 사용
3. **업체 직접 등록 기능 구현 금지 (MVP)**
4. **로그인이 필요한 페이지 크롤링 금지**
5. **API 키를 코드에 하드코딩 금지** — 반드시 환경변수 사용
6. **PRD.md의 MVP Scope 외 기능 임의 구현 금지**

---

## 🔑 환경변수 목록 (전체)

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # 크롤러/Edge Function 전용

# Expo
EXPO_PROJECT_ID=                 # EAS 프로젝트 ID

# GitHub Actions Secrets에 등록할 것
# SUPABASE_URL
# SUPABASE_SERVICE_ROLE_KEY
```

---

## ✅ 전체 프로젝트 완료 기준

- [ ] 5개 이상 업체 크롤링 정상 동작
- [ ] iOS/Android 앱 빌드 성공
- [ ] 이벤트 피드 → 필터 → 상세 → 아웃링크 플로우 정상 동작
- [ ] 푸시 알림 end-to-end 동작 확인
- [ ] QA 전체 테스트 통과
- [ ] SEC 취약점 0건
- [ ] MONITOR 대시보드 동작 확인
- [ ] 크롤링 자동화 (GitHub Actions) 동작 확인
