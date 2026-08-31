import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
// 키보드 처리. RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서 동작하지 않는 것이
// 알려진 문제라(react-native#16826, 미해결) 이 라이브러리를 쓴다. 앱 전체를 감싸야
// 화면들이 키보드 상태를 받아볼 수 있다.
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { View, Text, Image, StyleSheet, Dimensions } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { runPostOnboardingSetup } from '@/lib/initAds'
import { useThemeStore } from '@/stores/themeStore'
import { usePushNotification } from '@/hooks/usePushNotification'
import { isSupabaseConfigured } from '@/lib/supabase'
import { initAppUpdateChecker } from '@/lib/appUpdates'
import ProfileSheet from '@/components/ProfileSheet'

const ONBOARDING_KEY = 'sodate-onboarding-done'

export default function RootLayout() {
  const router = useRouter()
  usePushNotification()
  const { isDark, colors, load } = useThemeStore()
  useEffect(() => { load() }, [])
  // 앱을 강제 종료 안 하고 계속 켜둔 사용자도 OTA를 받게 — 포그라운드 전환마다 확인
  // (2026-08-14 오너 지시, lib/appUpdates.ts 참고).
  useEffect(() => initAppUpdateChecker(), [])
  // 온보딩 판정 전까지 첫 프레임(홈 스켈레톤/온보딩 인디케이터)이 잠깐 보이지 않도록
  // 스플래시와 동일한 화면으로 덮는다. 판정 끝나면 해제.
  const [gateOff, setGateOff] = useState(false)

  useEffect(() => {
    let alive = true
    async function checkOnboarding() {
      try {
        const done = await AsyncStorage.getItem(ONBOARDING_KEY)
        if (!done) {
          router.replace('/onboarding')
          // 처음 켠 사용자의 ATT 동의창은 온보딩 마지막에서 띄운다(app/onboarding.tsx).
          // 여기서 띄우면 앱이 뭔지 보기도 전에 물어 대부분 거부한다.
        } else if (alive) {
          runPostOnboardingSetup()
        }
      } finally {
        if (alive) setGateOff(true)
      }
    }
    checkOnboarding()
    // 안전장치: AsyncStorage가 지연돼도 게이트가 영구히 남지 않도록
    const t = setTimeout(() => { if (alive) setGateOff(true) }, 1500)
    return () => { alive = false; clearTimeout(t) }
  }, [])

  // 앱이 종료된 상태에서 알림 탭으로 실행된 경우 처리
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return
      const data = response.notification.request.content.data
      if (data?.event_id) {
        router.push(`/event/${data.event_id}`)
      }
    })
  }, [])

  // 빌드에 Supabase 환경변수가 안 실린 경우. 예전엔 여기서 앱이 그냥 죽어(첫 화면도 못 그림)
  // 사용자가 할 수 있는 게 없었다. 최소한 무슨 상황인지 알리고 문의 경로를 준다.
  if (!isSupabaseConfigured) {
    return (
      <KeyboardProvider>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.configErrorWrap}>
          <Image source={require('../assets/logo-stack.png')} style={styles.splashLogo} resizeMode="contain" />
          <Text style={styles.configErrorTitle}>서비스에 연결할 수 없습니다</Text>
          <Text style={styles.configErrorBody}>
            앱 설정에 문제가 있어 일정을 불러올 수 없습니다.{'\n'}
            잠시 후 다시 실행해 주세요.
          </Text>
          <Text style={styles.configErrorContact}>문의: admin@ourmine.co.kr</Text>
        </View>
      </SafeAreaProvider>
      </KeyboardProvider>
    )
  }

  return (
    <KeyboardProvider>
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="index"
          // 소개팅↔커뮤니티는 SwipeSegment가 자체 슬라이드 인 애니메이션을 직접 그린다.
          // 네이티브 스택 기본 전환(cross-fade 등)까지 겹치면 화면 가장자리에 이전 화면이
          // 잠깐 비쳐 보여 버그처럼 보였다(2026-08-08 오너 지적) — 기본 전환을 꺼서 SwipeSegment
          // 효과만 보이게 함.
          options={{ headerShown: false, animation: 'none' }}
        />
        <Stack.Screen
          name="event/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="place/[id]" options={{ headerShown: false }} />
        <Stack.Screen
          name="company/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="reviews/index" options={{ headerShown: false }} />
        {/* 게시판. 등록하지 않으면 기본 헤더에 'board/index' 같은 경로가 그대로 뜬다.
            animation:'none' 이유는 위 index 주석 참고(SwipeSegment와 전환이 겹치던 것). */}
        <Stack.Screen name="board/index" options={{ headerShown: false, animation: 'none' }} />
        {/* 4탭 확장(2026-08-21) — NEW_TABS_ENABLED 로 숨긴 채 개발 중. animation 'none' 으로
            탭 전환 시 슬라이드 없이 즉시 바뀐다(바텀 탭 표준). */}
        <Stack.Screen name="socialing/index" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="honsul/index" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="my/index" options={{ headerShown: false, animation: 'none' }} />
        <Stack.Screen name="my/scraps" options={{ headerShown: false }} />
        <Stack.Screen name="my/recent" options={{ headerShown: false }} />
        <Stack.Screen name="my/reviews" options={{ headerShown: false }} />
        <Stack.Screen name="board/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="board/write" options={{ headerShown: false }} />
        <Stack.Screen name="board/mine" options={{ headerShown: false }} />
        <Stack.Screen name="board/blocked" options={{ headerShown: false }} />
        <Stack.Screen name="board/author/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="favorites/index" options={{ headerShown: false }} />
        <Stack.Screen name="alerts" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="privacy" options={{ headerShown: false }} />
        <Stack.Screen name="terms" options={{ headerShown: false }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.background } }}
        />
      </Stack>

      {/* 내 정보(나이·성별) 시트 — 전역 마운트. 어느 화면에서든 TopBar '내 정보'로 그 자리에서 열림 */}
      <ProfileSheet />

      {/* 스플래시 연장 게이트 — 온보딩 판정 전 첫 프레임(동그라미 인디케이터 등)을 덮음.
          logo-stack(app.json 미참조, fingerprint 영향 없음)을 사용 — splash-icon.png는
          네이티브 빌드에 실제 반영되기 전까지 OTA 되돌림 대상이라 여기서 쓰면 안 됨
          (2026-07-26: 되돌림 여파로 옛 플레이스홀더가 노출된 사고 재발 방지).
          크기는 네이티브 스플래시와 이음새 없게 맞춤 — splash-icon.png는 1024 캔버스에
          그림이 62%라 화면폭의 62%로 그려지므로, 여백 없는 logo-stack도 62%로 맞춘다. */}
      {!gateOff && (
        <View style={styles.splashGate} pointerEvents="none">
          <Image
            source={require('../assets/logo-stack.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </View>
      )}
    </SafeAreaProvider>
    </KeyboardProvider>
  )
}

// 네이티브 스플래시(splash-icon.png는 1024 캔버스에 그림이 33%)와 크기를 맞추기 위해
// 화면폭의 33%로 고정. logo-stack.png는 여백이 없는 원본(429x684)이라 비율만 곱한다.
// ⚠️ 2026-08-31 이름을 '소밋'으로 바꾸며 글자가 짧아져 그림 폭이 62% → 33%로 줄었다.
//    두 값(여기와 splash-icon.png 안의 그림 비율)은 항상 같이 움직여야 이음새가 안 생긴다.
const SPLASH_LOGO_W = Dimensions.get('window').width * 0.33

const styles = StyleSheet.create({
  splashGate: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  // ⚠️ width:'%' + aspectRatio 조합은 퍼센트가 안 풀려 이미지가 원본 크기(821dp,
  // 화면폭의 2배 이상)로 터져나옴 — 2026-07-28 실제 사고. 화면폭에서 직접 계산할 것.
  splashLogo: { width: SPLASH_LOGO_W, height: SPLASH_LOGO_W * (684 / 429) },
  configErrorWrap: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  configErrorTitle: {
    marginTop: 28,
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  configErrorBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 21,
    color: '#9A9AA2',
    textAlign: 'center',
  },
  configErrorContact: {
    marginTop: 20,
    fontSize: 13,
    color: '#FF6B9D',
  },
})
