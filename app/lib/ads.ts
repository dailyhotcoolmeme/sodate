import { Platform } from 'react-native'
import { TestIds } from 'react-native-google-mobile-ads'

/**
 * 광고 단위 ID 중앙 관리 파일.
 *
 * ┌─ 출시 전 할 일 ───────────────────────────────────────────────┐
 * │ 애드몹에서 iOS/Android 앱을 각각 등록하고 "네이티브" 광고 단위를 │
 * │ 만든 뒤, 발급받은 광고 단위 ID를 아래 REAL 값에 넣기만 하면 됩니다.│
 * │ (형식: ca-app-pub-XXXXXXXX/XXXXXXXX)                            │
 * │                                                                │
 * │ ⚠️ 이 파일의 ID는 "광고 단위 ID"입니다.                          │
 * │    app.json 의 androidAppId/iosAppId(=앱 ID)와는 별개이며,       │
 * │    앱 ID 2개도 실제 값으로 교체해야 합니다.                        │
 * └────────────────────────────────────────────────────────────────┘
 *
 * 안전장치:
 *  - 개발 빌드(__DEV__)에서는 항상 구글 테스트 광고를 사용합니다.
 *    (실제 광고를 개발 중 클릭하면 애드몹 계정이 정지될 수 있음)
 *  - 실제 ID를 아직 안 넣었으면(빈 문자열) 자동으로 테스트 광고로 폴백합니다.
 *    → ID만 채우면 프로덕션에서 즉시 실광고로 전환됩니다. 다른 코드 수정 불필요.
 */
const REAL = {
  native: {
    ios: '',     // 예: 'ca-app-pub-1234567890123456/1111111111'
    android: '', // 예: 'ca-app-pub-1234567890123456/2222222222'
  },
} as const

function resolve(real: { ios: string; android: string }, test: string): string {
  if (__DEV__) return test
  const id = Platform.OS === 'ios' ? real.ios : real.android
  return id || test
}

/** 피드 목록 사이 + 이벤트 상세 신청 버튼 위에 쓰는 네이티브 광고 단위 ID */
export const NATIVE_AD_UNIT_ID = resolve(REAL.native, TestIds.NATIVE)
