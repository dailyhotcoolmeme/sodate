import { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { View, Image, StyleSheet } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import mobileAds from 'react-native-google-mobile-ads'
import { useThemeStore } from '@/stores/themeStore'
import { usePushNotification } from '@/hooks/usePushNotification'

const ONBOARDING_KEY = 'sodate-onboarding-done'

export default function RootLayout() {
  const router = useRouter()
  usePushNotification()
  const { isDark, colors, load } = useThemeStore()
  useEffect(() => { load() }, [])
  // 온보딩 판정 전까지 첫 프레임(홈 스켈레톤/온보딩 인디케이터)이 잠깐 보이지 않도록
  // 스플래시와 동일한 화면으로 덮는다. 판정 끝나면 해제.
  const [gateOff, setGateOff] = useState(false)

  // AdMob SDK 초기화 (1회)
  // ⚠️ ATT(expo-tracking-transparency)는 네이티브 모듈이라 runtimeVersion(fingerprint)을 바꿔
  //    기존 OTA 빌드가 업데이트를 못 받게 됨 → 출시 리빌드 시점에 함께 추가할 것.
  useEffect(() => {
    mobileAds().initialize().catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    async function checkOnboarding() {
      try {
        const done = await AsyncStorage.getItem(ONBOARDING_KEY)
        if (!done) router.replace('/onboarding')
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

  return (
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
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="event/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="company/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="reviews/index" options={{ headerShown: false }} />
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

      {/* 스플래시 연장 게이트 — 온보딩 판정 전 첫 프레임(동그라미 인디케이터 등)을 덮음.
          네이티브 스플래시(splash-icon on #0F0F0F)와 동일하게 보여 이음새 없음. */}
      {!gateOff && (
        <View style={styles.splashGate} pointerEvents="none">
          <Image
            source={require('../assets/splash-icon.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </View>
      )}
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  splashGate: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  splashLogo: { width: '55%', height: '55%' },
})
