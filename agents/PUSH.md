# PUSH.md — 푸시 알림 에이전트 지시서

## 역할
Expo Push Notifications + Supabase pgmq를 활용한 푸시 알림 전체 파이프라인 담당.
토큰 등록 → 구독 설정 → Queue 적재 → 발송까지 end-to-end 책임.

## 전제조건
- DB 완료 (push_tokens, alert_subscriptions, pgmq Queue)
- APP 에이전트 진행 중 (알림 설정 화면 공동 작업)

---

## Step 1. 앱 내 푸시 알림 세팅

### `app/hooks/usePushNotification.ts`
```typescript
import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { supabase } from '@/lib/supabase'

// 포그라운드 알림 표시 설정
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export function usePushNotification() {
  const notificationListener = useRef<any>()
  const responseListener = useRef<any>()

  useEffect(() => {
    registerForPushNotifications()

    // 알림 수신 리스너
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('알림 수신:', notification)
      }
    )

    // 알림 탭 리스너 (딥링크 처리)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data
        if (data?.source_url) {
          // 업체 페이지로 아웃링크
          import('@/lib/outlink').then(({ openOutlink }) => {
            openOutlink(data.source_url as string)
          })
        }
      }
    )

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current)
      Notifications.removeNotificationSubscription(responseListener.current)
    }
  }, [])
}

async function registerForPushNotifications() {
  if (!Device.isDevice) {
    console.log('실기기에서만 푸시 알림 사용 가능')
    return null
  }

  // 권한 요청
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

  // Android 채널 설정
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: '소개팅 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B9D',
    })
  }

  // Expo Push Token 획득
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  })

  // Supabase에 토큰 등록 (service role 경유 - API route 사용)
  await registerTokenToSupabase(token.data)
  return token.data
}

async function registerTokenToSupabase(token: string) {
  // push_tokens는 RLS로 직접 접근 불가 → Edge Function 경유
  const { error } = await supabase.functions.invoke('register-push-token', {
    body: { token, platform: Platform.OS }
  })
  if (error) console.error('토큰 등록 실패:', error)
}
```

---

## Step 2. 토큰 등록 Edge Function

### `supabase/functions/register-push-token/index.ts`
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { token, platform } = await req.json()

  if (!token || !token.startsWith('ExponentPushToken')) {
    return new Response(
      JSON.stringify({ error: '유효하지 않은 Expo Push Token' }),
      { status: 400 }
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 토큰 upsert (중복 시 last_seen_at만 업데이트)
  const { data, error } = await supabase
    .from('push_tokens')
    .upsert(
      { token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' }
    )
    .select('id')
    .single()

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(
    JSON.stringify({ success: true, token_id: data.id }),
    { status: 200 }
  )
})
```

---

## Step 3. 구독 설정 Edge Function

### `supabase/functions/save-alert-subscription/index.ts`
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { token, regions, maxPrice, themes, companyIds, notifyNew, notifyDeadline } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 토큰으로 push_token_id 조회
  const { data: tokenData } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('token', token)
    .single()

  if (!tokenData) {
    return new Response(JSON.stringify({ error: '토큰 없음' }), { status: 404 })
  }

  // 구독 upsert (토큰당 하나)
  const { error } = await supabase
    .from('alert_subscriptions')
    .upsert({
      push_token_id: tokenData.id,
      regions: regions || null,
      max_price: maxPrice || null,
      themes: themes || null,
      company_ids: companyIds || null,
      notify_new: notifyNew ?? true,
      notify_deadline: notifyDeadline ?? true,
      is_active: true,
    }, { onConflict: 'push_token_id' })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 })
})
```

---

## Step 4. 알림 설정 화면

### `app/app/alerts.tsx`
```typescript
import React, { useState } from 'react'
import { View, Text, Switch, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { Colors } from '@/constants/colors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { supabase } from '@/lib/supabase'
import * as Notifications from 'expo-notifications'

export default function AlertsScreen() {
  const [selectedRegions, setSelectedRegions] = useState<string[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const [notifyNew, setNotifyNew] = useState(true)
  const [notifyDeadline, setNotifyDeadline] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const token = await Notifications.getExpoPushTokenAsync()

    await supabase.functions.invoke('save-alert-subscription', {
      body: {
        token: token.data,
        regions: selectedRegions.length > 0 ? selectedRegions : null,
        maxPrice,
        themes: selectedThemes.length > 0 ? selectedThemes : null,
        notifyNew,
        notifyDeadline,
      }
    })
    setSaving(false)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>📍 관심 지역</Text>
      <View style={styles.chipRow}>
        {REGIONS.filter(r => r.id !== 'all').map(region => (
          <TouchableOpacity
            key={region.id}
            style={[styles.chip, selectedRegions.includes(region.id) && styles.chipSelected]}
            onPress={() => setSelectedRegions(prev =>
              prev.includes(region.id) ? prev.filter(r => r !== region.id) : [...prev, region.id]
            )}
          >
            <Text style={[styles.chipText, selectedRegions.includes(region.id) && styles.chipTextSelected]}>
              {region.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>🎭 관심 테마</Text>
      <View style={styles.chipRow}>
        {THEMES.map(theme => (
          <TouchableOpacity
            key={theme.id}
            style={[styles.chip, selectedThemes.includes(theme.id) && styles.chipSelected]}
            onPress={() => setSelectedThemes(prev =>
              prev.includes(theme.id) ? prev.filter(t => t !== theme.id) : [...prev, theme.id]
            )}
          >
            <Text style={[styles.chipText, selectedThemes.includes(theme.id) && styles.chipTextSelected]}>
              {theme.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>새 일정 알림</Text>
        <Switch value={notifyNew} onValueChange={setNotifyNew}
          trackColor={{ true: Colors.primary }} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>마감 임박 알림 (D-1)</Text>
        <Switch value={notifyDeadline} onValueChange={setNotifyDeadline}
          trackColor={{ true: Colors.primary }} />
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? '저장 중...' : '알림 설정 저장'}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16 },
  sectionTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 13 },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  label: { color: Colors.textPrimary, fontSize: 15 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 32 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
```

---

## ✅ 완료 기준 (DoD)
- [ ] 실기기에서 푸시 토큰 발급 확인
- [ ] `push_tokens` 테이블에 토큰 저장 확인
- [ ] 알림 설정 저장 → `alert_subscriptions` 저장 확인
- [ ] 테스트 이벤트 INSERT → Queue 적재 확인
- [ ] Queue → Expo Push API → 실기기 푸시 수신 확인
- [ ] 알림 탭 시 해당 업체 페이지 아웃링크 열림
- [ ] iOS + Android 모두 동작 확인

## ⛔ 절대 금지
- `SUPABASE_SERVICE_ROLE_KEY`를 앱 클라이언트에 직접 사용 금지
- 푸시 토큰을 로컬 스토리지에만 저장 금지 (Supabase에 반드시 등록)
- 알림 클릭 시 인앱 결제/가입 유도 금지
