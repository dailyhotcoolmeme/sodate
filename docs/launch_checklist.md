# sodate 출시 점검 (2026-07-11 기준)

## ✅ 확인 완료 — 문제 없음
- **광고(AdMob)**: 실 앱ID 2개(app.json plugin) + 네이티브 광고단위 4개(lib/ads.ts) 실제값. 채널 게이팅(`Updates.channel==='production'`에서만 실광고, dev/preview=테스트광고 → 계정정지 방지). `userTrackingUsageDescription` 설정됨.
- **시크릿**: service_role/PAT 등 앱 번들에 없음. anon 키만(정상).
- **멈춤 방어**: `lib/supabase.ts` 전역 fetch 20초 타임아웃(PostgREST hang → UI 굳음 차단).
- **google-services.json**: 유효(project=sodate-173b5, package=com.sodate.app 일치).
- **식별자**: iOS bundleId=Android package=`com.sodate.app`. `ITSAppUsesNonExemptEncryption=false`(수출규정 프롬프트 회피).
- **약관/개인정보**: 이메일 `contact@ourmine.co.kr` 통일, 시행일 2026-07-20, 최종수정일 삭제(2026-07-11 완료).
- **EAS**: production 환경변수(SUPABASE URL/ANON) 등록됨. production 채널=실광고. OTA 정상(런타임 핀 iOS 9e0a068/Android e0cb73f).
- **알림**: expo-notifications 플러그인(아이콘·색) 설정. 디버그 잔재 거의 없음.

## 🔒 보안 감사 (2026-07-11, Supabase RLS/권한)
**수정 완료:**
- **event_candidates RLS 활성화** — 이전엔 RLS OFF+anon 전체권한(SELECT/INSERT/UPDATE/DELETE/**TRUNCATE**)이라 앱 공개키로 admin 후보목록 조작 가능했음 → RLS ON(anon 차단, service_role 우회).
- **pgmq_send/read/delete + 트리거 함수 anon 실행권한 회수** — 푸시 큐에 anon이 스팸 주입·큐 삭제 가능했음 → PUBLIC에서 revoke, service_role만 grant. anon 실행 가능은 알림 RPC 5개(자기 p_token용)만 남김.

**정상(의도된 설계) 확인:**
- events/companies: anon은 SELECT만(쓰기 정책 없음). reviews/push_tokens/alert_subscriptions 쓰기는 Edge Function(reviews·register-push-token·save-alert-subscription, service_role) 경유. INFO(RLS-no-policy)는 안전 상태.

**남은 경고(비블로커, 무회원 모델 한계):**
- `favorites_all` 정책이 anon 무제한(모든 favorites 읽기/삭제 가능) — 저사양 그리핑 위험(즐겨찾기 삭제). 무회원이라 근본 차단 불가. 남용 발생 시 Edge Function화 검토.
- function search_path mutable / pg_net in public — 하드닝(비블로커).

## 🧪 코드 견고성 감사 (2026-07-11, 서브에이전트)
- **CRITICAL 크래시 없음.** 네비게이션 전 경로 정상(데드버튼 없음), 상세/업체 화면 에러·빈상태 UX 정상, 아웃링크 허용목록 로직 견고(suffix-spoof 차단), null 접근 대부분 가드됨.
- **수정 완료(MEDIUM)**: ①openOutlink 실패 시 throw(먹통+unhandled rejection)→Alert 피드백 ②홈 네트워크실패가 '빈목록'처럼 보이던 것→에러+다시시도 ③useReviews/useAllReviews/useFavorites/useCompanies fetch 실패 시 스피너 안 멈추던 것·unhandled rejection 방어.
- **현재 13개 업체 도메인 전부 아웃링크 허용목록에 포함**(신청하기 먹통 업체 없음). 신규 업체 추가 시 `lib/security.ts` 도메인 추가 필요.
- 앞서 supabase 전역 fetch 타임아웃(hang성 멈춤 차단)도 적용됨.

## ⚠️ 출시 전 반드시 (스토어 제출 블로커)
1. **개인정보처리방침 공개 URL** — App Store·Play 심사에 **호스팅된 개인정보 URL 필수**(앱 내 화면만으론 부족). 앱 privacy.tsx 내용을 웹(ourmine.co.kr 등)에 게시 필요.
2. **production 프로파일 새 빌드 + 스토어 제출** — 실광고·실앱ID는 production 빌드에서만. `eas build --profile production`(iOS·Android) → `eas submit`. 현재 오너 설치본=preview(테스트광고).
3. **스토어 계정/메타데이터** — App Store Connect·Play Console 앱 등록, 스크린샷, 설명, **연령등급(소개팅=청소년이용불가/17+ 검토)**, 카테고리. eas.json submit 프로파일 비어있음 → 제출 시 자격증명 필요.

## 📝 재빌드 때 함께 (네이티브 — OTA 불가)
4. **새 앱 아이콘**(오너 교체 예정) — app.json icon/adaptiveIcon/splash-icon 교체. **iOS 스플래시 "동그라미"도 이때 해결**(옛 빌드에 구워진 옛 런치스크린이라 재빌드로만 교체됨).
5. **ATT(App Tracking Transparency)** — iOS 개인화광고/IDFA용 `expo-tracking-transparency` 추가 권장(광고수익↑). 없어도 비개인화광고는 노출·심사 통과엔 필수 아님. 리빌드 시 추가(_layout에 주석으로 명시됨).
6. **buildNumber/versionCode** — 현재 null(첫 빌드=1 자동). 다음 빌드부터 EAS 원격버전관리 or autoIncrement 권장.
