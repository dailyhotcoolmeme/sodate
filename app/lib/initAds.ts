import { AppState } from 'react-native'
import mobileAds from 'react-native-google-mobile-ads'
import { registerForPushNotifications } from '@/hooks/usePushNotification'

/** 앱이 포그라운드(active)가 될 때까지 기다린다. ATT 팝업은 active 에서만 뜬다. */
function waitUntilActive(timeoutMs = 5000): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => { sub.remove(); clearTimeout(t); resolve() }
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') done() })
    // 영영 active 가 안 되는 경우(백그라운드 실행 등)에 매달리지 않게 상한을 둔다.
    const t = setTimeout(done, timeoutMs)
  })
}

// 온보딩을 넘긴 뒤에 한 번만 도는 초기화 — 시스템 권한 팝업 2개와 AdMob 초기화.
//
// 왜 온보딩 뒤인가: 띄우는 "시점"이 수락률을 크게 좌우한다. 앱을 켜자마자 아무 맥락
// 없이 물으면 대부분 거부한다.
//   · 알림을 거부하면 이 앱의 핵심인 새 일정 알림·마감 임박 알림을 영영 못 보낸다.
//   · ATT를 거부하면 IDFA가 닫혀 iOS 광고가 전부 비맞춤으로 내려가 단가가 떨어진다.
//
// 호출 지점 두 곳(둘이 겹칠 수 있어 여기서 한 번만 돌게 막는다):
//   · 처음 켠 사용자   : 온보딩 마지막(app/onboarding.tsx)
//   · 이미 온보딩한 사용자 : 앱 진입 시(app/_layout.tsx)
//
// ⚠️ Info.plist의 NSUserTrackingUsageDescription만 있고 ATT 요청이 실제로 안 돌면,
//    App Store 개인정보 라벨의 "추적 사용" 선언과 바이너리가 어긋나 심사에서 걸린다.
let started = false

export async function runPostOnboardingSetup(): Promise<void> {
  if (started) return
  started = true

  // 1) 알림 권한 — 사용자가 기대하는 팝업이라 먼저 띄운다
  try {
    await registerForPushNotifications()
  } catch {
    // 거부·실기기 아님 등은 그냥 통과(앱 동작에는 지장 없음)
  }

  // 2) 추적 권한(iOS ATT) → 3) AdMob 초기화
  //
  // ⚠️ iOS 는 앱이 UIApplicationStateActive 가 아니면 ATT 팝업을 **아무 말 없이 건너뛴다**
  //    (에러도 안 나고 status 만 undetermined 로 돌아온다). 바로 위에서 알림 권한 팝업을
  //    띄웠다 닫은 직후가 정확히 그 구간이라, 새로 설치한 기기에서 추적 팝업이 안 떴다.
  //    2026-09-01 애플이 이걸 Guideline 2.1 로 반려했다
  //    ("we are unable to locate the App Tracking Transparency permission request").
  //    그래서 (a) 앱이 active 가 될 때까지 기다리고 (b) 한 박자 쉰 뒤에 요청한다.
  try {
    const { requestTrackingPermissionsAsync, getTrackingPermissionsAsync } =
      await import('expo-tracking-transparency')
    const cur = await getTrackingPermissionsAsync()
    // 이미 답한 사용자에게 다시 묻지 않는다(iOS 가 한 번만 보여준다).
    if (cur.status === 'undetermined' || cur.canAskAgain) {
      await waitUntilActive()
      await new Promise((r) => setTimeout(r, 700))
      await requestTrackingPermissionsAsync()
    }
  } catch {
    // 안드로이드·ATT 없는 구버전 iOS는 통과. 거부해도 광고 자체는 나간다
    // (비맞춤으로 내려갈 뿐) 이라 실패를 삼켜도 된다.
  }

  // AdMob 초기화를 앱 진입 직후가 아니라 살짝 뒤로 미룬다(2026-08-21 오너 제보).
  // 콜드 스타트 순간엔 Google Play Services 가 아직 안 깨어난 경우가 있어, 그때 AdMob 이
  // Play Services/Play Integrity 를 건드리면 시스템이 "Something went wrong / Check that
  // Google Play is enabled" 다이얼로그를 띄운다(우리 JS 로는 못 막는 네이티브 팝업).
  // 첫 화면이 뜨고 광고가 실제로 필요해지기 전까지 몇 초 여유를 주면 Play Services 가
  // 준비돼 이 충돌이 크게 줄어든다. 광고는 목록을 스크롤해야 자리가 나오므로 지연돼도 무방.
  setTimeout(() => { mobileAds().initialize().catch(() => {}) }, 4000)
}

/** @deprecated 이름만 남긴 하위호환. runPostOnboardingSetup을 쓸 것. */
export const initAdsWithTracking = runPostOnboardingSetup
