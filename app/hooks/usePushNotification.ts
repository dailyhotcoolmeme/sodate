import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform, AppState } from 'react-native'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { setCachedPushToken } from '@/lib/pushToken'
import { useNotificationStore } from '@/stores/notificationStore'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export function usePushNotification() {
  const notificationListener = useRef<Notifications.Subscription | null>(null)
  const responseListener = useRef<Notifications.Subscription | null>(null)

  useEffect(() => {
    registerForPushNotifications()

    notificationListener.current = Notifications.addNotificationReceivedListener(
      () => {
        // 앱 켜진 상태로 알림 수신 → 종 배지 갱신
        useNotificationStore.getState().refreshUnread()
      }
    )

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data
        // 알림을 눌러 진입 → 읽음 처리 + 종 배지 0
        useNotificationStore.getState().markReadOnServer()
        if (data?.event_id) {
          // 이벤트 상세 화면으로 이동
          router.push(`/event/${data.event_id}`)
        } else if (data?.source_url) {
          import('@/lib/outlink').then(({ openOutlink }) => {
            openOutlink(data.source_url as string)
          })
        }
      }
    )

    return () => {
      notificationListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [])

  // 앱 아이콘 배지 초기화(OS) + 종 배지(인앱) 동기화: 실행 시 + 포그라운드 복귀 시
  useEffect(() => {
    const onActive = () => {
      Notifications.setBadgeCountAsync(0).catch(() => {}) // OS 아이콘 배지
      useNotificationStore.getState().refreshUnread() // 인앱 종 배지(안읽음 수)
    }
    onActive()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') onActive()
    })
    return () => sub.remove()
  }, [])
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('실기기에서만 푸시 알림 사용 가능')
    return null
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    console.log('푸시 알림 권한 거부')
    return null
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '소개팅 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B9D',
    })
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  })

  setCachedPushToken(token.data)
  await registerTokenToSupabase(token.data)
  return token.data
}

async function registerTokenToSupabase(token: string): Promise<void> {
  const { error } = await supabase.functions.invoke('register-push-token', {
    body: { token, platform: Platform.OS },
  })
  if (error) console.error('토큰 등록 실패:', error)
}
