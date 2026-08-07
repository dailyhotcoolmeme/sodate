# sodate 출시 점검 (2026-07-28 전면 재점검)

> 2026-07-11 1차 점검 이후 아이콘 교체·페이지네이션·이메일 변경 등 변경이 커서 전면 재점검함.
> 법적문서 / 보안 / 스토어요건 / 앱품질 4개 영역을 각각 독립 조사한 결과를 통합.
> **중요**: 이번 점검에서 저장소 코드만으로는 발견 불가능한 치명 이슈(DB 트리거 내 시크릿)가
> 실 DB 직접 조회로 발견됨. 앞으로 보안 점검은 반드시 운영 DB 조회를 포함할 것.

---

## 🔴 출시 차단 — 보안

### S1. `notify_new_event` DB 트리거에 service_role 키 평문 하드코딩 [치명]
- `events` INSERT 트리거(`on_event_inserted`, 현재 활성)가 `net.http_post`로 `match-subscriptions`를
  호출하며 `Authorization: Bearer <service_role JWT>`를 **함수 본문에 평문 저장**.
- git·마이그레이션 어디에도 없음(대시보드/SQL로 직접 생성됨) → 코드 리뷰·시크릿 스캔으로 발견 불가.
- service_role은 RLS 전면 우회 마스터 키. DB 덤프/백업/협업자 권한만 있어도 노출.
- **조치**: ① service_role 키 rotate ② 트리거를 Supabase Vault 또는 Database Webhooks로 전환
  ③ 마이그레이션으로 캡처.
- ⚠️ **rotate 시 GitHub Actions(크롤·워치독)·CF Worker·Edge Function이 동시에 끊김. 순서 조율 필수.**

### S2. `favorites` 테이블 anon 전체 읽기/쓰기/삭제 가능 [높음]
- 정책이 `favorites_all: ALL / public / USING(true) / WITH CHECK(true)`.
- **실증됨**: anon 키로 필터 없이 전체 조회 시 실사용자 데이터 반환(삭제는 훼손 우려로 미실행).
- 앱은 `.eq('device_id', id)`로 "내 것만" 거른다고 가정하지만 서버가 강제하지 않음.
- 2026-07-11에 "무회원 한계, 비블로커"로 수용했으나 현재는 실사용 데이터 존재.
- **조치**: `notification_logs` RPC 패턴과 동일하게 RLS `USING(false)` + `SECURITY DEFINER` RPC
  (`get_my_favorites(p_device_id)`, `toggle_favorite(...)`)로 전환.

### S3. 앱 내장 공개키만으로 전 구독자 대상 가짜 푸시 발송 가능 [높음]
- `match-subscriptions`가 요청 본문(`{record}`)을 웹훅 페이로드로 무검증 신뢰.
- `verify_jwt: true`지만 앱에 내장된 anon 키가 유효 JWT라 사실상 인증 역할 못 함.
- **조치**: 공유 시크릿 헤더(Vault 저장) 검증 추가 또는 Database Webhooks 서명 검증 사용.
  `event_id`의 실제 존재 여부 사전 검증도 권장.

---

## 🔴 출시 차단 — 법적

### L1. 공개 웹 문서의 문의 이메일 미갱신
- 인앱(`app/app/terms.tsx`, `privacy.tsx`, `settings.tsx`)은 `admin@ourmine.co.kr`로 통일됨.
- **그러나 스토어 심사에 실제 노출되는** `~/dev/ourmine-home/sodate/privacy.html`, `terms.html`은
  `contact@ourmine.co.kr` 그대로. 상호 `주식회사 아워마인`도 웹에만 있고 인앱엔 없음.
- 2026-07-11 문서의 "이메일 통일 완료" 기록은 **인앱 한정이었고 웹은 누락**이었음.

### L2. 개인정보처리방침 법정 필수기재사항 3건 누락 (개인정보보호법 제30조)
- 없음: **안전성 확보조치** / **개인정보 보호책임자 성명·직책** / **권익침해 구제기관 연락처**
- 미흡: 파기 "절차·방법" 서술(보유기간만 있음)
- 구제기관은 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118) 등 명시 필요.

### L3. 실제 수집하는 나이·성별이 방침에 없음
- `components/ProfileSheet.tsx` → `stores/profileStore.ts`(AsyncStorage) → `hooks/useEvents.ts`에서
  Supabase 쿼리 필터로 전송됨.
- 방침 1절 수집항목에 없고, 본문에 "실명·연락처·이메일 등은 수집하지 않습니다"만 있어 오해 소지.

### L4. 국외이전 고지 불완전 (개인정보보호법 제28조의8)
- Supabase(미국)·Google LLC를 "처리위탁"으로만 기재. 국외이전은 이전국가·항목·일시/방법·
  연락처·목적·보유기간·거부권까지 별도 고지 요건.

### L5. 이용약관 면책조항 과도 [권고]
- "업체와의 분쟁·환불·불만에 책임지지 않습니다" 등이 예외 없이 서술됨.
- 약관규제법 제7조상 고의·중과실 전면면책은 무효 → "고의 또는 중대한 과실의 경우는 예외" 추가 권고.

---

## 🔴 출시 차단 — 앱 품질

### A1. 환경변수 누락 시 앱 전체 크래시 + 복구 UI 없음
- `lib/supabase.ts:4-5`가 `process.env.EXPO_PUBLIC_SUPABASE_*!`로 단정 → 값 없으면 모듈 로드 시 throw.
- 앱 전체에 **ErrorBoundary 0개** (grep 확인).
- **2026-07-28 실제 발생**: 로컬 릴리스 빌드에 env가 안 실려 안드 앱이 실행 즉시 종료됨.
- **조치**: `!` 제거 + 값 부재 시 안내 화면, 최상위 ErrorBoundary 추가, EAS 전 프로필 env 존재 재확인.

---

## 🟡 반려 위험 — 스토어

### P1. 미사용 `SYSTEM_ALERT_WINDOW` 권한이 release 매니페스트에 포함
- `android/app/src/main/AndroidManifest.xml:4`. 오버레이 기능 코드 없음. dev-client 잔재로 추정.
- **조치**: `expo prebuild --clean` 후 재확인. 남으면 원인 플러그인 특정해 제거.

---

## ⚠️ 오너 결정 필요

### D1. 연령 정책 3중 모순
| 위치 | 내용 |
|---|---|
| `app/app/terms.tsx:40` | "만 19세 이상이어야 합니다(청소년 이용불가)" |
| `docs/store_submission_guide.md:3-8` | "콘텐츠 기준 등급, 청소년이용불가로 가지 않는다 / 12~15세 수렴 예상" |
| 앱 실제 | 연령 확인 UI **전혀 없음**(온보딩은 슬라이드 4장뿐) |

성인전용 선언 + 무검증 + 12~15세 등급 신고는 서로 안 맞음. 둘 중 하나 선택 필요:
- (A) 등급 유지 → 약관의 "만19세/청소년이용불가" 문구를 완화·삭제
- (B) 성인전용 유지 → 온보딩에 최소 자기신고형 연령 확인 추가

### D2. 모드파티 로그인 크롤링
- `crawler/scrapers/modparty.py`가 `MODPARTY_ID/PW`로 실제 로그인 수행.
- `CLAUDE.md:143` "로그인이 필요한 페이지 크롤링 금지" 위반.
- 자격증명 관리 자체는 안전(시크릿 마스킹, 하드코딩 없음).
- **확인 필요**: 이 계정이 정식 제휴 계정인지 여부. 아니면 ToS/법적 리스크.

---

## 🟠 중간 — 보안

- **S4** `register-push-token`이 `verify_jwt:false` + 토큰 포맷검증·rate limit 없음 → 스팸 삽입 가능.
- **S5** `sodate-ocr` 워커가 fail-open (`if (env.OCR_SECRET && ...)`) → 시크릿 미설정 시 공개 API가 됨.
  운영에 `OCR_SECRET`이 실제 설정됐는지 **확인 필요**.
- **S6** 마이그레이션 ↔ 실 DB drift: `favorites`, `notification_logs`, `review_reports`, 알림 RPC 5개,
  `notify_new_event` 트리거, `event_candidates` RLS가 전부 실DB에만 존재하고 `supabase/migrations/`에 없음.
  → 재해복구 시 보안설정이 복원되지 않음. `supabase db diff`로 캡처 필요.
- **S7** admin 로그인 무차별 대입 방어 없음(`admin/functions/api/login.ts:24` 단순 비교).
  → Cloudflare Rate Limiting / Turnstile 권장.
- **S8** admin `upload.ts` MIME 미검증 → 이론상 저장형 XSS(업로드가 인증 필요라 실위험 낮음).
- **S9** `pgmq.*` 원본 함수에 anon EXECUTE grant 잔존(PostgREST 미노출이라 도달 불가, 방어심층 차원 revoke 권장).
- **S10** 의존성: admin high 3건(react-router, ws). app critical 1/high 7 — 대부분 빌드타임 툴체인이라
  런타임 노출 아님. `security.yml`의 `npm audit`이 `|| true`로 non-blocking인 점 검토.

## 🟠 중간 — 앱 품질

- **A2** 찜 목록 로드 실패가 "찜한 게 없음"과 동일 표시(`hooks/useFavorites.ts:84-104`).
  다른 훅들과 달리 error 상태·재시도 없음 → 사용자는 찜이 사라진 줄 앎.
- **A3** `useRegions`/`useHashtags`에 try/catch 없음 → unhandled rejection.
  같은 버그를 `useCompanies.ts:29-39`에서는 이미 고쳐놨음(형제 훅 재발).
- **A4** 테스트: `package.json`에 `test` 스크립트 없음. `EventCard.test.tsx`는 모듈 해석 실패로
  **아예 실행 안 됨**(`Cannot find module 'expo-asset'`). 통과한 16건은 전부 filterStore 것.
- **A5** 죽은 코드: `lib/eventInfo.ts`, `components/ParticipantStatsSheet.tsx`,
  `EventCard.tsx:152-160` 미사용 스타일, `analytics.ts:35` `participant_stats_view` 타입.
- **A6** 앱 켤 때 흰 화면 번쩍임 — `expo-splash-screen` 미설치. 검정 스플래시 설정과 리소스는 있으나
  이를 붙들어두는 모듈이 없어 JS 로드 전 기본 배경이 드러남.

## 🟢 권고 — 스토어

- **P2** ATT 미구현(`expo-tracking-transparency` 미설치). 심사 통과엔 불필요하나 iOS 개인화광고 불가.
  → App Store Connect 개인정보 설문에서 "추적 안 함"으로 답할 것.
- **P3** `PrivacyInfo.xcprivacy`의 `NSPrivacyCollectedDataTypes`가 빈 배열(실제로는 푸시토큰·광고ID 수집).
  → App Store Connect 설문과 개인정보방침이 일치하도록 기입.
- **P4** `buildNumber`/`versionCode` 미설정(기본 1). 최초 제출은 무방하나 다음 빌드부터 충돌.
  → `eas.json`에 `"cli": {"appVersionSource": "remote"}` 권장.
- **P5** GDPR/UMP 동의 코드 없음(`AdsConsent` grep 0건). 한국 단독 배포면 무관.
  → **결정됨(2026-08-07, 오너)**: iOS는 **전 세계(175개국)**, 안드로이드는 현재 제출분이
    대한민국 1개(검토 통과 후 넓힐지 재논의). 전 세계 배포이므로 GDPR/UMP는 다시 검토 대상.
- **P6** Gradle 메모리 설정이 휘발성 — `android/gradle.properties`는 prebuild마다 재생성됨.
  로컬 빌드 계속하면 `expo-build-properties`로 고정 필요(EAS 클라우드 빌드는 불필요).
  (2026-07-28: Metaspace 512MB로 `expo-updates:kspReleaseKotlin` OOM 발생 → 6GB/2GB로 상향)

---

## ✅ 정상 확인 (점검 범위 기록용)

**보안**
- git 추적 파일 + 전체 히스토리(`git log -p --all -S`) 스캔: service_role 등 시크릿 커밋 이력 없음.
- `.gitignore` 정상: `app/.env.local`, `crawler/.env`, `admin/.env` 전부 미추적.
- 앱의 `EXPO_PUBLIC_SUPABASE_ANON_KEY`는 디코드 결과 `role: anon` — 의도된 공개키.
- admin 세션 설계 우수: HMAC-SHA256 서명, `HttpOnly; Secure; SameSite=Strict`, service_role은 서버 프록시에만.
- `push_tokens`, `alert_subscriptions`, `event_candidates` anon 차단 PoC 재확인(`[]` 반환).
- 알림 RPC 5개는 `where token = p_token` 정확 스코핑 + search_path 고정.
- 아웃링크: 전 화면이 `openOutlink`→`isAllowedOutlink` 경유, WebView 직접 사용 없음, 도메인 화이트리스트.
- GH Actions 워크플로 전부 `schedule`/`workflow_dispatch`만 — 포크 PR 시크릿 유출 경로 없음.
  `security.yml`에 TruffleHog + pip-audit/npm audit 이미 구성됨.
- modparty 외 스크래퍼는 로그인 로직 없음.

**스토어**
- 식별자 일치: iOS bundleId = Android package = `com.sodate.app`. `google-services.json` 정합.
- `ITSAppUsesNonExemptEncryption=false` 확정.
- Android 권한 정합(`SYSTEM_ALERT_WINDOW` 제외): INTERNET, POST_NOTIFICATIONS(런타임 요청 확인),
  부팅/알림 관련, AdMob 표준. 카메라·위치·연락처 없음.
- iOS Usage Description은 `NSUserTrackingUsageDescription` 1개만 — 해당 기능만 있으므로 정합.
- `PrivacyInfo.xcprivacy` 존재, Required Reason API 선언됨.
- targetSdkVersion 36 확인(제출 시점 Play 정책 재대조 권장).
- AdMob: 실 퍼블리셔 ID `ca-app-pub-2792582436871752` 전 파일 통일. 테스트 ID는
  `__DEV__`/preview 채널 폴백에서만(`Updates.channel==='production'`에서만 실광고) — 계정정지 방지 설계.
- **개인정보처리방침 공개 URL 이미 라이브**: `ourmine.co.kr/sodate/privacy`·`/terms` 200 확인.
  `app-ads.txt`도 200이며 AdMob ID 일치. (2026-07-11 문서엔 "미완료 블로커"로 잘못 기록돼 있었음)
- 계정 삭제 요건(Apple 5.1.1(v)) **해당 없음** — 회원가입/로그인 없는 익명 구조.

**앱 품질**
- 아웃링크 null/빈값 가드 + 실패 시 Alert 피드백 정상.
- 광고 로드 실패 시 `return null` — 빈 박스·레이아웃 밀림 없음. "광고" 배지 명시.
- `useEvents`/`useEventDetail`/`useCompany`/`useReviews` 전부 `finally`로 로딩 해제 보장.
- 후기/신고: 익명 소유권 해시 검증, 비속어 필터, 길이 제한, AsyncStorage 전부 try/catch.

---

## 📋 수동 확인 필요 (코드로 판단 불가)

- 🔴 **iOS 판매 지역(Pricing and Availability → 사용 가능 여부) 설정 여부** —
  **심사 승인만으로는 스토어에 안 올라간다.** 판매 지역이 비어 있으면 승인돼도
  "This app was removed from sale from the App Store"로 남아 아무도 못 받는다.
  API로 확인: `GET /v1/apps/{id}/appAvailabilityV2` 가 404면 **미설정**이다.
  (2026-08-07 실제 사고: 최초 제출 때 설정을 누락해, 심사 통과 후에도 앱이 스토어에
   안 나타났다. 원인은 이 문서 P5의 "확인 필요: 배포 국가"가 오너에게 질문되지 않은 채
   미해결로 남은 것 → 미결 질문은 반드시 오너에게 되물을 것.)
- 🔴 **Play 출시 국가 설정 여부** — 프로덕션 트랙에 국가가 지정돼 있어야 게시된다.
- 스토어 스크린샷(iPhone 6.7"/6.5", Android) — 저장소에 없음, 별도 준비.
- App Store Connect / Play Console 앱 등록, 연령등급 설문, Data Safety 폼 제출 여부.
- `eas.json`의 `submit.production`이 빈 객체 — Apple Team ID/앱 특정 비밀번호,
  Android 서비스계정 JSON 필요.
- AdMob 결제 프로필·세금 정보 등록 여부.
- Cloudflare WAF/Rate limiting 실제 적용 여부, `OCR_SECRET` 운영 설정 여부.
- admin 운영자 수와 `ADMIN_PW` 강도.
- 크롤링 대상 사이트들의 ToS상 크롤링 허용 여부(법적 검토 범위 밖).

---

## 🗂 이번에 완료된 항목 (2026-07-28)

- 새 앱 아이콘 적용 — 핑크 배경 + 흰 하트(1안 확정). 스플래시·알림·적응형 아이콘·admin favicon 포함.
- 상단바 = 가로형 워드마크 이미지, 설정 상단 = 세로형 로고.
- 스플래시 로고가 화면 밖으로 터지던 버그 수정(`width:'%' + aspectRatio` 조합 문제).
- 인앱 문의 이메일 `admin@ourmine.co.kr` 통일(**웹 공개문서는 미완 — L1 참조**).
- 이벤트 목록 페이지네이션(685건 중 585건 안 보이던 문제).
