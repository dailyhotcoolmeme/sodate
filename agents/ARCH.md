# ARCH.md — 아키텍처 에이전트 지시서

## 역할
프로젝트 전체 골격을 세우는 에이전트입니다.
다른 모든 에이전트가 시작하기 전에 완료되어야 합니다.

---

## 실행 순서

### Step 1. Expo 앱 초기화
```bash
cd sodate/
npx create-expo-app app --template blank-typescript
cd app
```

### Step 2. 앱 의존성 설치
```bash
npx expo install expo-router expo-notifications expo-web-browser
npx expo install @supabase/supabase-js
npx expo install zustand
npx expo install @shopify/flash-list          # 고성능 리스트
npx expo install expo-image                   # 이미지 최적화
npx expo install expo-linking
npx expo install expo-constants
npx expo install react-native-safe-area-context
npx expo install react-native-screens
npx expo install expo-status-bar
npm install --save-dev @types/react @types/react-native
```

### Step 3. 폴더 구조 생성
아래 구조를 정확히 생성하세요:

```
sodate/
├── app/                               ← Expo 앱 루트
│   ├── app/                           ← Expo Router 화면
│   │   ├── _layout.tsx                ← 루트 레이아웃
│   │   ├── index.tsx                  ← 홈 피드 화면
│   │   ├── event/
│   │   │   └── [id].tsx               ← 이벤트 상세
│   │   ├── company/
│   │   │   └── [id].tsx               ← 업체 상세
│   │   ├── alerts.tsx                 ← 알림 설정
│   │   └── settings.tsx              ← 설정
│   ├── components/
│   │   ├── EventCard.tsx              ← 이벤트 카드
│   │   ├── EventCardSkeleton.tsx      ← 로딩 스켈레톤
│   │   ├── FilterSheet.tsx            ← 필터 바텀시트
│   │   ├── CompanyBadge.tsx           ← 업체 뱃지
│   │   ├── ThemeTag.tsx               ← 테마 태그
│   │   ├── DeadlineBadge.tsx          ← 마감 임박 뱃지
│   │   └── EmptyState.tsx             ← 빈 상태
│   ├── hooks/
│   │   ├── useEvents.ts               ← 이벤트 목록 훅
│   │   ├── useEventDetail.ts          ← 이벤트 상세 훅
│   │   ├── useCompany.ts              ← 업체 정보 훅
│   │   ├── useFilter.ts               ← 필터 상태 훅
│   │   └── usePushNotification.ts     ← 푸시 알림 훅
│   ├── stores/
│   │   ├── filterStore.ts             ← 필터 상태 (Zustand)
│   │   └── alertStore.ts              ← 알림 구독 상태 (Zustand)
│   ├── lib/
│   │   ├── supabase.ts                ← Supabase 클라이언트
│   │   └── outlink.ts                 ← 아웃링크 핸들러
│   ├── constants/
│   │   ├── regions.ts                 ← 지역 목록
│   │   ├── themes.ts                  ← 테마 목록
│   │   └── colors.ts                  ← 디자인 토큰
│   ├── types/
│   │   └── database.types.ts          ← Supabase 자동생성 타입
│   ├── app.json
│   ├── eas.json
│   ├── tsconfig.json
│   └── .env
│
├── crawler/                           ← Python 크롤러
│   ├── scrapers/
│   │   ├── __init__.py
│   │   ├── base_scraper.py            ← 공통 기본 클래스
│   │   ├── lovematching.py
│   │   ├── yeonin.py
│   │   ├── emotional_orange.py
│   │   ├── frip.py
│   │   └── munto.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── event.py                   ← 이벤트 데이터 모델
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── supabase_client.py
│   │   ├── logger.py
│   │   └── image_extractor.py
│   ├── tests/
│   │   ├── test_lovematching.py
│   │   └── test_base.py
│   ├── main.py
│   ├── requirements.txt
│   └── .env
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_create_companies.sql
│   │   ├── 002_create_events.sql
│   │   ├── 003_create_push_tokens.sql
│   │   ├── 004_create_alert_subscriptions.sql
│   │   ├── 005_create_crawl_logs.sql
│   │   ├── 006_create_pgmq_queue.sql
│   │   └── 007_rls_policies.sql
│   └── functions/
│       ├── match-subscriptions/
│       │   └── index.ts
│       └── process-push-queue/
│           └── index.ts
│
├── .github/
│   └── workflows/
│       ├── crawl.yml                  ← 크롤링 자동화
│       ├── test.yml                   ← 테스트 자동화
│       └── build.yml                  ← 앱 빌드
│
├── CLAUDE.md
├── agents/
└── docs/
```

### Step 4. 설정 파일 생성

#### `app/tsconfig.json`
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

#### `app/app.json`
```json
{
  "expo": {
    "name": "소개팅모아",
    "slug": "sodate",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#0F0F0F"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.sodate.app"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0F0F0F"
      },
      "package": "com.sodate.app"
    },
    "plugins": [
      "expo-router",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#FF6B9D"
        }
      ]
    ],
    "scheme": "sodate",
    "extra": {
      "eas": {
        "projectId": ""
      }
    }
  }
}
```

#### `app/.env` (템플릿만 생성, 실제 값은 절대 커밋 금지)
```bash
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

#### `crawler/requirements.txt`
```
playwright==1.44.0
beautifulsoup4==4.12.3
httpx==0.27.0
python-dotenv==1.0.1
supabase==2.5.0
pydantic==2.7.1
python-dateutil==2.9.0
pytest==8.2.0
pytest-asyncio==0.23.7
```

#### `crawler/.env` (템플릿만 생성)
```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### Step 5. .gitignore 생성
```gitignore
# 환경변수
.env
.env.local
*.env

# Node
node_modules/
.expo/
dist/

# Python
__pycache__/
*.pyc
.venv/
venv/

# EAS
.eas/

# OS
.DS_Store
Thumbs.db
```

### Step 6. GitHub Actions 기본 워크플로우

#### `.github/workflows/test.yml`
```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-crawler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - name: Install dependencies
        run: |
          cd crawler
          pip install -r requirements.txt
          playwright install chromium
      - name: Run tests
        run: |
          cd crawler
          pytest tests/ -v

  test-app:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: |
          cd app
          npm ci
      - name: Type check
        run: |
          cd app
          npx tsc --noEmit
```

---

## ✅ 완료 기준 (DoD)

- [ ] 전체 폴더 구조 생성 완료
- [ ] `cd app && npx expo start` 에러 없이 실행
- [ ] TypeScript 타입 에러 0개 (`npx tsc --noEmit`)
- [ ] `cd crawler && pip install -r requirements.txt` 성공
- [ ] `.env` 파일 템플릿 생성 (실제 값은 비어있음)
- [ ] `.gitignore`에 `.env` 포함 확인
- [ ] GitHub Actions 워크플로우 파일 생성

## ⛔ 절대 금지
- `.env`에 실제 API 키 값 입력 금지
- `node_modules` 커밋 금지
- `__pycache__` 커밋 금지
