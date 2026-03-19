import { useEffect } from 'react'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Colors } from '@/constants/colors'

const ONBOARDING_KEY = 'sodate-onboarding-done'

export default function RootLayout() {
  const router = useRouter()

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
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.textPrimary,
          contentStyle: { backgroundColor: Colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen
          name="index"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="event/[id]"
          options={{ title: '소개팅 상세' }}
        />
        <Stack.Screen
          name="company/[id]"
          options={{ title: '업체 정보' }}
        />
        <Stack.Screen name="reviews/index" options={{ headerShown: false }} />
        <Stack.Screen name="alerts" options={{ title: '알림 설정' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
      </Stack>
    </SafeAreaProvider>
  )
}
