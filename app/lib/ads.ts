import { Platform } from 'react-native'
import { TestIds } from 'react-native-google-mobile-ads'
import * as Updates from 'expo-updates'

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
// 자리별로 광고 단위를 분리(리포트/최적화 목적). AdMob에서 '네이티브' 형식으로 각각 생성.
const REAL = {
  // 피드 목록 사이
  feedNative: {
    ios: 'ca-app-pub-2792582436871752/2969141781',
    android: 'ca-app-pub-2792582436871752/7824094203',
  },
  // 이벤트 상세 신청 버튼 위
  detailNative: {
    ios: 'ca-app-pub-2792582436871752/8391070415',
    android: 'ca-app-pub-2792582436871752/1087295469',
  },
} as const

// 테스트 광고를 쓸지 판정한다.
//
// ⚠️ 예전엔 "Updates.channel === 'production' 일 때만 실광고"였다. 그런데 이 값은
//    앱 시작 직후 비어 있을 수 있어(네이티브 updates 설정을 아직 못 읽은 상태),
//    스토어 빌드인데도 테스트 광고로 떨어지는 실행이 생겼다 — 그 실행은 수익이 0이다.
//    같은 빌드에서 실행마다 테스트 광고가 보였다 안 보였다 한 원인(2026-07-29 오너 관측).
//    그래서 판정을 뒤집는다: "테스트 채널일 때만 테스트 광고", 모르면 실광고.
//
// 내부 테스트 중 실광고를 눌러 계정이 정지되는 건 AdMob '테스트 기기 등록'으로 막는다
// (등록된 기기는 실광고 단위로 요청해도 테스트 광고가 내려온다). 광고 단위를 바꿔치기해
// 막는 방식은 이번처럼 실수로 프로덕션까지 새기 때문에 쓰지 않는다.
const TEST_CHANNELS = new Set(['development', 'preview'])

function useTestAds(): boolean {
  if (__DEV__) return true
  try {
    const ch = Updates.channel
    return !!ch && TEST_CHANNELS.has(ch)
  } catch {
    return false
  }
}

function resolve(real: { ios: string; android: string }, test: string): string {
  if (useTestAds()) return test
  const id = Platform.OS === 'ios' ? real.ios : real.android
  return id || test
}

// ⚠️ 광고 ID는 반드시 "요청하는 시점"에 계산한다. 예전엔 모듈 로드 시점에 상수로 굳혔는데,
//    그때는 Updates.channel이 아직 준비되지 않은 경우가 있어 테스트 광고 ID로 고정돼 버렸다.
//    실행할 때마다 타이밍이 갈려 어떤 실행은 테스트 광고, 어떤 실행은 실광고가 나갔고,
//    테스트 광고가 나간 실행은 수익이 0이다(2026-07-29 안드로이드에서 실제 관측:
//    같은 빌드인데 실행마다 테스트 광고가 보였다 안 보였다 함).
/** 피드 목록 사이 네이티브 광고 단위 ID */
export const getFeedNativeAdUnitId = () => resolve(REAL.feedNative, TestIds.NATIVE)
/** 이벤트 상세 신청 버튼 위 네이티브 광고 단위 ID */
export const getDetailNativeAdUnitId = () => resolve(REAL.detailNative, TestIds.NATIVE)
