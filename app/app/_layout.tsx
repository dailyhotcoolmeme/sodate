import { useEffect } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useThemeStore } from '@/stores/themeStore'
import { usePushNotification } from '@/hooks/usePushNotification'

const ONBOARDING_KEY = 'sodate-onboarding-done'

export default function RootLayout() {
  const router = useRouter()
  usePushNotification()
  const { isDark, colors, load } = useThemeStore()
  useEffect(() => { load() }, [])

  useEffect(() => {
    async function checkOnboarding() {
      const done = await AsyncStorage.getItem(ONBOARDING_KEY)
      if (!done) {
        router.replace('/onboarding')
      }
    }
    checkOnboarding()
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
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="privacy" options={{ title: '개인정보처리방침' }} />
        <Stack.Screen name="terms" options={{ title: '이용약관' }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: colors.background } }}
        />
      </Stack>
    </SafeAreaProvider>
  )
}
