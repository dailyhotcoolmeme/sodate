import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'

// 이 기기의 Expo 푸시 토큰(알림 내역 조회 키). 등록 시 캐시해두고 재사용.
const KEY = 'sodate_push_token'
let cached: string | null = null

export function setCachedPushToken(token: string) {
  cached = token
  AsyncStorage.setItem(KEY, token).catch(() => {})
}

export async function getCachedPushToken(): Promise<string | null> {
  if (cached) return cached
  try {
    const stored = await AsyncStorage.getItem(KEY)
    if (stored) {
      cached = stored
      return stored
    }
  } catch {}
  // 캐시에 없으면(권한 있는 실기기에 한해) 직접 조회
  try {
    if (!Device.isDevice) return null
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return null
    const t = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    })
    setCachedPushToken(t.data)
    return t.data
  } catch {
    return null
  }
}
