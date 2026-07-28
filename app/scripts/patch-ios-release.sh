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
