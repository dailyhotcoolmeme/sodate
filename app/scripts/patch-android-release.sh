#!/usr/bin/env bash
# android/ 는 prebuild 산출물이라 `expo prebuild --clean` 할 때마다 아래 두 가지가 날아간다.
# 스토어 빌드 직전에 반드시 이 스크립트를 돌릴 것.
#
#  1) 프로덕션 업데이트 채널 주입
#     로컬 gradle 빌드에는 EAS가 넣어주는 채널 헤더가 없어 Updates.channel 이 undefined 가 된다.
#     그러면 lib/ads.ts 의 isProductionBuild() 가 false → 스토어 빌드에 구글 "테스트 광고"가
#     실려 수익이 0이 된다(2026-07-28 iOS에서 먼저 발견해 Expo.plist에 같은 값을 넣었다).
#  2) 릴리스 서명키
#     RN 템플릿 기본값이 debug.keystore 라 그대로 두면 Play 업로드가 거부된다.
set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST=android/app/src/main/AndroidManifest.xml
GRADLE=android/app/build.gradle

if ! grep -q 'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY' "$MANIFEST"; then
  python3 - "$MANIFEST" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
anchor = '<meta-data android:name="expo.modules.updates.EXPO_UPDATE_URL"'
inject = ('<meta-data android:name="expo.modules.updates.'
          'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" '
          'android:value="{&quot;expo-channel-name&quot;:&quot;production&quot;}"/>\n    ')
s = s.replace(anchor, inject + anchor, 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  echo "✓ AndroidManifest: production 채널 주입"
fi

if ! grep -q 'sodate-upload.keystore' "$GRADLE"; then
  python3 - "$GRADLE" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
s = s.replace("""        debug {
            storeFile file('debug.keystore')""", """        release {
            storeFile file('../../certs/sodate-upload.keystore')
            storePassword 'sodate2026upload'
            keyAlias 'sodate-upload'
            keyPassword 'sodate2026upload'
        }
        debug {
            storeFile file('debug.keystore')""", 1)
s = s.replace("""            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug""", "            signingConfig signingConfigs.release", 1)
open(p, 'w', encoding='utf-8').write(s)
PY
  echo "✓ build.gradle: 업로드 키스토어 서명 적용"
fi

grep -n 'expo-channel-name' "$MANIFEST"
grep -n 'signingConfigs.release' "$GRADLE"
