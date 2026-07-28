#!/usr/bin/env bash
# ios/ 는 prebuild 산출물이라 `expo prebuild` 할 때마다 아래가 날아간다.
# 스토어 빌드 직전에 반드시 이 스크립트를 돌릴 것. (안드로이드 짝: patch-android-release.sh)
#
# 프로덕션 업데이트 채널 주입 —
#   로컬 xcodebuild 빌드에는 EAS가 넣어주는 채널 헤더가 없어 Updates.channel 이 undefined 가
#   된다. 그러면 lib/ads.ts 의 isProductionBuild() 가 false → 스토어 빌드에 구글 "테스트
#   광고"가 실려 수익이 0이 된다(2026-07-28 실제로 잡아낸 사고).
set -euo pipefail
cd "$(dirname "$0")/.."

PLIST=ios/app/Supporting/Expo.plist

if ! /usr/libexec/PlistBuddy -c "Print :EXUpdatesRequestHeaders" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :EXUpdatesRequestHeaders dict" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :EXUpdatesRequestHeaders:expo-channel-name string production" "$PLIST"
  echo "✓ Expo.plist: production 채널 주입"
fi

/usr/libexec/PlistBuddy -c "Print :EXUpdatesRequestHeaders" "$PLIST"

# 시스템 권한 팝업(ATT·알림)의 제목·버튼 한글화.
#   iOS는 앱 번들에 실제 .lproj 폴더가 있어야 그 앱을 해당 언어 지원으로 인정한다.
#   CFBundleLocalizations 만 선언하면 부족해서, 제목·버튼이 영어로 뜨고 본문(내가 쓴
#   NSUserTrackingUsageDescription)만 한글로 나온다 — 2026-07-28 실기기에서 확인.
#   .lproj 폴더 자체는 app.json 의 expo.locales 가 만들어 Xcode 프로젝트에 등록한다.
#   다만 locales 파일 "내용"은 안드로이드 문자열 리소스로도 복사돼, iOS 전용 키를 넣으면
#   안드로이드 lint(ExtraTranslation)가 릴리스 빌드를 막는다. 그래서 locales 는 비워 두고
#   문구는 여기서 넣는다.
KO_STRINGS=ios/app/Supporting/ko.lproj/InfoPlist.strings
if [ -d "$(dirname "$KO_STRINGS")" ]; then
  printf 'NSUserTrackingUsageDescription = "회원님께 더 관련성 높은 광고를 제공하기 위해 사용됩니다.";\n' > "$KO_STRINGS"
  echo "✓ ko.lproj/InfoPlist.strings 작성"
fi
