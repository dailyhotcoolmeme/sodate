import mobileAds from 'react-native-google-mobile-ads'
import { registerForPushNotifications } from '@/hooks/usePushNotification'

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
  try {
    const { requestTrackingPermissionsAsync } = await import('expo-tracking-transparency')
    await requestTrackingPermissionsAsync()
  } catch {
    // 안드로이드·ATT 없는 구버전 iOS는 통과. 거부해도 광고 자체는 나간다
    // (비맞춤으로 내려갈 뿐) 이라 실패를 삼켜도 된다.
  }

  mobileAds().initialize().catch(() => {})
}

/** @deprecated 이름만 남긴 하위호환. runPostOnboardingSetup을 쓸 것. */
export const initAdsWithTracking = runPostOnboardingSetup
