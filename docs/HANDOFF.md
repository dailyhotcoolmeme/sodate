# 이어받기 문서 (2026-08-07)

> 세션이 끊겨도 바로 이어서 작업할 수 있게 남긴다. 새 세션은 이 문서부터 읽는다.
> 이전(8/1) 버전 내용은 게시판 UI 세부사항이었고 전부 병합·완료되어 이 문서에서 들어냈다 —
> 필요하면 git log(`715d96d`, `게시판: 답글 팝업화...` 등)에서 찾을 것.

---

## 1. 지금 무엇을 하고 있었나 — 애플 심사 대응

**iOS 앱스토어 심사가 진행형이다.** Submission ID `0f2d0cbb-44a8-4f18-9166-b9a764ce0ab2`,
Guideline 1.2(UGC)로 세 번 반려 → build 7 → **purpose string 문제로 4번째 반려**
→ **build 8을 2026-08-07 00:12(KST) 재제출, 현재 "Waiting for Review" 상태다.**
다음 세션은 여기서부터: **App Store Connect에 결과가 와 있는지부터 확인할 것.**

### 4번째 반려 (2026-08-06 21:28) — Guideline 1.2 아님, 자동 분석 건

- 반려 사유: `NSMicrophoneUsageDescription`의 목적 문구가 플레이스홀더
  (`"Allow $(PRODUCT_NAME) to access your microphone"`)라 불충분. **사람 리뷰 전
  자동 스캔 단계에서 걸린 것**이라 1.2 UGC 언급은 아예 없었다 → build 7의 UGC
  대응 자체는 리뷰어에게 전달된 것으로 보인다.
- **원인**: `expo-image-picker` config plugin이 prebuild 때 카메라·마이크 usage
  description을 기본 영문 문구로 자동 삽입. 사진첩 문구만 한글로 채워뒀고 나머지
  둘은 손대지 않은 상태였다.
- **앱은 이 둘을 안 쓴다** — `lib/boardImage.ts:46`의 `launchImageLibraryAsync`(사진첩)
  하나뿐이고 `launchCameraAsync`도, 녹음 관련 패키지도 없다.
- **조치(build 8)**: 문구를 채우는 대신 **두 키를 제거**(애플 안내 2번 선택지).
  - `ios/app/Info.plist`에서 `NSCamera`/`NSMicrophoneUsageDescription` 삭제
  - `app.json`의 expo-image-picker 플러그인에 `cameraPermission: false`,
    `microphonePermission: false` → prebuild 재실행해도 다시 안 들어옴 (커밋 `b5c177d`)
  - archive 산출물의 Info.plist를 직접 열어 두 키 부재 + `CFBundleVersion 8` 확인 후 업로드
  - **카메라 키도 같이 지운 이유**: 같은 플레이스홀더 + 미사용이라 다음 자동 스캔에
    또 걸릴 게 뻔했다. 애플은 마이크만 지적했지만 한 번에 정리.

### 반려 히스토리 요약

1. **8/3**: Guideline 2.1(a)(글 수정 버튼 안 눌림) + 1.2(UGC 보호장치 없음) 동시 반려.
   2.1(a)는 `getPostForEdit` 이미 있어서 해결. 1.2 대응으로 이용약관 동의·차단·신고
   알림 이메일을 새로 만듦.
2. **8/4, 8/5**: 같은 1.2로 재반려. 반려 문구가 매번 조금씩 구체화됨 — 8/5 반려는
   "blocking mechanism과 flagging mechanism은 다르다"는 문장이 새로 추가됨(차단이
   운영자에게도 통보돼야 하는데 신고랑 완전히 분리해뒀던 게 원인 — 수정함).
3. **8/6, 진짜 원인 발견**: 리뷰어가 반려 메일에 **자기가 테스트한 화면 스크린샷을
   첨부**했는데, 거기 약관 동의 체크박스도 차단 버튼도 없었다. 원인: 그동안 수정사항을
   **OTA(EAS Update, JS만 갱신)로만 배포**했는데, OTA는 앱을 완전히 재시작해야, 그것도
   네트워크가 몇 초 안에 받쳐줘야 적용된다. 심사 기기가 그 타이밍을 못 맞춰서 **옛날
   바이너리를 그대로 테스트한 것**이었다. → **buildNumber 6→7로 올려서 모든 수정사항을
   네이티브 바이너리에 직접 박아 새로 빌드·제출.** 앞으로 UGC/심사 관련 코드 변경은
   **OTA에 의존하지 말고 네이티브 빌드로 낼 것.**

### 8/6에 한 일 (순서대로)

1. 리뷰어 첨부 스크린샷 4장을 App Store Connect에서 다운로드해 실제로 확인(증거 확보).
2. `app.json`(`ios.buildNumber`) · `ios/app/Info.plist`(`CFBundleVersion`) 6→7.
3. 로컬 `xcodebuild archive` → `-exportArchive`(자동 서명, Apple Development 인증서로
   archive 해도 exportOptions.plist가 app-store-connect 방식으로 재서명함) →
   `eas submit -p ios --path <ipa>` 로 build 7 업로드.
   - **주의**: `ios/` 밑에 `build/`라는 이름으로 archive 출력 경로를 잡으면 안 된다 —
     React Native Codegen이 그 경로(`ios/build/generated/...`)에 자동생성 파일을 두므로
     이름이 겹치면 `rm -rf build`가 codegen 산출물까지 지워서 빌드가 깨진다(실제로
     이 세션에서 한 번 겪음 — `pod install`로 재생성해서 복구, 이후 archive 출력은
     `archive_output/`으로 분리).
4. App Store Connect의 **"Reply to App Review"**(반려됨 상태에서만 뜨는 실제 회신
   입력창 — 오너가 먼저 알아챔, "심사 업데이트→다시 제출"을 누르면 이 창이 잠겨서
   사라진다는 것도 확인됨)에 원인·수정 내용을 영문으로 회신.
5. App Review Information의 **메모(Notes)** 필드도 build 7 내용으로 갱신(기존 영상
   링크는 유지) — 회신 내용과 메모 내용이 서로 어긋나지 않도록.
6. 빌드 6 제거 → 빌드 7 추가 → Save → **Resubmit to App Review**. 상태 "Waiting for
   Review" 확인.

---

## 2. 이번 세션에서 고친 진짜 버그 (심사와 별개, 실사용 버그)

### 알림 해제 후에도 큐에 밀린 푸시가 나가던 버그 (2026-08-03, 완료·배포됨)

- **증상**: 사용자가 알림을 껐는데 몇 시간~하루 넘게 지나서 그 사용자에게 푸시가 갔다.
- **원인**: `process-push-queue`(pgmq 소진해서 실제 발송하는 함수)가 `match-subscriptions`가
  enqueue 시점에 얼려둔 대상자 목록(`target_tokens`)을 그대로 믿고 보냈다 — **발송
  직전에 현재도 알림이 켜져 있는지 재확인을 안 함.** 실측: 큐에 최대 34시간·13건 적체.
- **수정**: `supabase/functions/process-push-queue/index.ts` — 발송 직전
  `alert_subscriptions`를 다시 조회해서 `is_active` + (타입별) `notify_new`/`notify_deadline`
  이 지금도 true인 토큰만 걸러서 보낸다. 배포 완료, 커밋 `d4289e0`.
- **부가 조치**: `.github/workflows/crawl.yml`에 큐 소진 스텝을 마감알림 enqueue 직후에도
  한 번 더 추가(적체 자체를 줄임).

### 게시판 차단 시 운영자 신고 미접수 (2026-08-04, 완료·build 7에 포함)

- 차단(block)과 신고(report)를 완전히 분리해뒀던 게 애플 1.2 반려 사유였다. 이제
  차단하면 `lib/board.ts`의 `report()`도 함께 호출돼 `board_reports`에 쌓이고
  `notify-admin-report` 이메일이 자동 발송된다. 커밋 `ac7096c`.

### 게시판 owner_token 노출로 인한 전체 피드 다운 사고 (2026-08-03, 즉시 복구됨)

- 차단 기능 만들며 클라이언트가 `owner_token`(작성자 익명 해시)을 읽게 했는데, DB
  권한(`revoke/grant select`)이 그 컬럼을 막고 있어서 목록 조회 자체가 전부 실패했다.
  `grant select (owner_token) on board_posts/board_comments to anon, authenticated`로
  즉시 복구. 마이그레이션 `20260803b_board_owner_token_grant.sql`.

---

## 3. 이번에 새로 만든 것 (게시판 UGC 보호장치, 애플 1.2 대응)

- **이용약관 사전 동의**: `app/app/board/write.tsx` — 첫 글 등록 시에만 체크박스,
  한 번 동의하면 `AsyncStorage`(`lib/boardIdentity.ts`)에 남아 다시 안 물어봄.
- **작성자 차단**: `lib/boardIdentity.ts`(`blockAuthor`/`getBlockedAuthors`/`unblockAuthor`),
  `hooks/useBoard.ts`(목록·상세 조회 시 필터링), `app/board/blocked.tsx`(차단 목록·해제
  화면, 햄버거 메뉴에서 진입). 차단 기준은 **owner_token 해시 노출**(오너가 명시적으로
  승인한 방식 — AskUserQuestion으로 확인함, 닉네임 기준 아님).
- **신고 접수 시 운영자 이메일**: `supabase/functions/notify-admin-report/index.ts`
  (parkinon-app의 `notify-admin-content` 참고해 이식) + `board_reports` INSERT 시 발동하는
  pg_net 트리거(`fn_board_report_notify`, 마이그레이션 `20260803_board_report_notify.sql`).
  시크릿은 `BOARD_REPORT_SECRET`(Supabase 시크릿) + Postgres Vault
  (`board_report_hook_secret`, DB에만 있고 git엔 없음) 이중 구조.

---

## 4. 인증/시크릿 — 어디 있고 왜 그렇게 했는지

**중요(오너 지시, 2026-08-03)**: Supabase personal access token은 **다시 요청하지 말 것.**
한 번 발급받은 걸 계속 재사용하라고 명시적으로 지시받았다.

| 무엇 | 어디 | 비고 |
|---|---|---|
| Supabase PAT | `app/certs/supabase-access-token.txt` | gitignore됨(`app/certs/`), 재사용 지시받음. `export SUPABASE_ACCESS_TOKEN=$(cat app/certs/supabase-access-token.txt)` 로 CLI에 사용 |
| board_report_hook_secret | `app/certs/board-report-hook-secret.txt` | pg_net 트리거 전용, WEBHOOK_SECRET과 별개(그 값은 write-only라 몰라서 새로 만듦) |
| App Store Connect API 키 | `app/certs/AuthKey_9URM5MR2DL.p8` | Key ID `9URM5MR2DL`, Issuer `e65cf392-198b-437d-a5a4-d6d697692559`, 앱 ID `6795389152` |
| Google Play 서비스 계정 | `app/certs/play-service-account.json` | 원래 parkinon-play-api용, sodate에 권한 추가 부여받음 |
| GMAIL_USER/GMAIL_APP_PASSWORD | Supabase 시크릿(값 조회 불가, write-only) | admin@ourmine.co.kr, 앱 비밀번호는 오너가 폰으로 발급해서 준 값 |

### Management API로 SQL 직접 실행(대시보드 안 거치고)

```bash
export TOKEN=$(cat app/certs/supabase-access-token.txt)
curl -sS -X POST "https://api.supabase.com/v1/projects/xgcldcnqfqcugkcifyae/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"query":"select 1;"}'
```

### App Store Connect API 직접 호출(JWT 직접 서명, jsonwebtoken 패키지 불필요)

`ES256`, `crypto.createSign('SHA256')` + `dsaEncoding: 'ieee-p1363'`. 이 세션에서 여러 번
써서 검증됨 — 리뷰 메모(`appStoreReviewDetails`) 조회/수정, 버전·빌드 조회 등 가능.
단, **`appStoreVersionSubmissions` 생성(POST)은 API로 막혀 있음**(403, "Allowed
operation is: DELETE") — 재제출 액션 자체는 **브라우저(App Store Connect UI)로 해야
한다.** "심사 업데이트" → "앱 심사에 다시 제출" 순서.

---

## 5. App Store Connect UI 사용법 (여러 번 반복해서 확인된 것)

- **★ 작업 순서는 반드시 "회신 먼저 → 그다음 빌드 제출"이다(오너 지시, 2026-08-07).**
  재제출을 먼저 해버리면 회신을 못 남기고, 실제로 그것 때문에 심사자가 우리 설명을
  못 본 적이 있다.
- **회신 입력창**은 버전이 "Rejected"(제출이 `UNRESOLVED_ISSUES`) 상태일 때만 뜬다.
  제출 상세 페이지(`/distribution/reviewsubmissions/details/{submissionId}`) 맨 아래
  "앱 심사에 회신" 버튼 → 모달에서 작성(4000자 제한) → 회신.
  - **잠기는 시점은 "심사 업데이트"를 누를 때다.** 2026-08-07에 실측: 빌드를 8로
    교체하고 **저장**까지 해서 버전 상태가 "제출 준비 중"으로 바뀐 뒤에도 회신창은
    그대로 살아 있었다(제출 자체는 `UNRESOLVED_ISSUES` 유지). 순서를 어겼더라도
    "심사 업데이트" 전이면 회신 가능 — 다만 위 원칙대로 회신부터 하는 게 안전하다.
  - 상태 확인은 브라우저보다 API가 빠르다:
    `GET /v1/apps/{id}/reviewSubmissions?limit=10` → `state` 필드
    (`sort` 파라미터는 이 엔드포인트에서 400 에러가 난다).
- **빌드 교체**: 버전 페이지(`/distribution/ios/version/inflight`) → Build 섹션 →
  기존 빌드 행에 마우스 올리면 빨간 "−" 아이콘 → 클릭해서 제거 → "Add Build" → 새
  빌드 선택 → Done → 페이지 상단 **Save**(중요, 안 누르면 반영 안 됨) → 상태가
  "Prepare for Submission"으로 바뀌면 **Update Review** → 리뷰어 스크린샷/메시지가
  있는 제출 상세 페이지로 이동 → **Resubmit to App Review**.
- **리뷰어 첨부 스크린샷**: 제출 상세 페이지의 "Items Submitted" 표 안, 반려 사유
  아래 "Screenshot-MMDD-HHMMSS.png · Download" 형태로 걸려있다. **놓치지 말고 확인할
  것** — 이번에 진짜 원인을 찾은 게 이것 때문이었다.
- 로그인 세션이 자주 끊긴다(`authResult=FAILED`로 리다이렉트) — 오너가 직접 로그인해야
  하고, 2단계 인증도 오너 몫이다.

---

## 6. 안드로이드 — 할 일 없음

이번 세션에서 만든 수정사항(약관 동의·차단 등)은 전부 JS라 **EAS Update(OTA)로 이미
안드로이드에 반영 완료**됐다. iOS 애플 심사 통과 여부와 무관하게 안드로이드는 이미
최신 상태 — 별도 플레이스토어 재제출 불필요(네이티브 코드 변경이 없는 한 계속 그렇다).

```bash
cd app && npx eas update --branch production --environment production --message "..." --non-interactive
```

---

## 7. 오너 스타일/규칙 (반복 지적받은 것)

- **막히면 방법을 스스로 찾을 것.** 진짜 사용자 전용 액션(계정 로그인, OS 권한 승인
  다이얼로그, 밖에 있어서 새 시크릿 발급 불가)만 예외. 그 외엔 API·CLI·다른 경로를
  찾아서라도 직접 처리.
- **의논 없이 기능부터 만들지 말 것** — 예전에 게시판 광고를 물어보지도 않고 배포했다가
  강하게 지적받고 전부 되돌린 적 있음(OTA로 배포한 것까지 되돌리는 추가 배포까지 함).
  "~하자"/"~해볼까" 같은 제안성 발화와 "해줘"를 구분할 것.
- **Supabase PAT 재요청 금지**(위 4번 참고).
- 반려/버그 원인을 **추측으로 설명하지 말 것** — 이번 세션에서 실제 DB 쿼리(큐 적체
  34시간), 리뷰어 첨부 스크린샷으로 증거를 먼저 확보한 뒤에야 설명했고, 그렇게 했을 때
  오너가 신뢰함. 반대로 API가 "Allowed operation: DELETE" 같은 애매한 에러를 냈을 때
  브라우저로 실제 UI 확인부터 하는 식으로 검증 없이 우기지 않음.
- 화면을 못 보고 "됐다"고 말하지 않는다 — 실기기 녹화·스크린샷으로 직접 확인.

---

## 8. DB 직접 조회

```bash
cd /Users/ourmine/dev/sodate/crawler && export $(grep -v '^#' .env | xargs)
curl -s "$SUPABASE_URL/rest/v1/board_posts?select=*" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

⚠️ PostgREST는 한 번에 **1000행**까지만 준다. 나눠 받을 것.

pgmq 큐 상태 확인(Management API SQL 경로 사용):
```sql
select queue_length, total_messages from pgmq.metrics('push_notifications');
```

---

## 9. 다음 세션에서 바로 할 일

1. **App Store Connect에서 build 8 심사 결과 확인부터.** 통과했으면 게시판 콘텐츠
   채우기·정식 출시로 넘어가면 되고, 또 반려됐으면 **리뷰어 첨부 스크린샷을 가장 먼저
   확인**할 것. 자동 분석 반려면 스크린샷 없이 반려 문구에 어떤 키가 문제인지 그대로
   적혀 온다.
   - build 8 제출 시 이미 처리해둔 것: 애플에 영문 회신 전송(원인·조치 설명),
     App Review 메모에 "2026-08-07 재제출 (build 8)" 문단 추가(기존 build 7 문단 유지).
2. 통과 후: 이용약관 페이지(`app/app/terms.tsx`)에 이미 게시판 조항 반영해뒀는지
   재확인, 스크린 레코딩(구글드라이브 링크`1BCc2W7CcX83w9pBnIAQoFCVP_t7q-JN8`)이
   build 7 화면과 실제로 일치하는지 필요시 재촬영.
3. 로컬 `app/ios/archive_output/`에 빌드 산출물이 남아있다 — 용량 크면 정리 고려
   (git엔 안 잡힘, `.gitignore` 확인 필요할 수도 있음).
