/**
 * 앱 행동 분석 — 비동기 배치 전송
 * - 앱 성능에 영향 없도록 fire-and-forget
 * - 실패 시 조용히 무시
 * - device_id: AsyncStorage 영구 저장
 * - session_id: 앱 실행당 1회 생성 (메모리)
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { supabase } from './supabase'

const SESSION_ID = generateId()
let deviceIdCache: string | null = null

// 배치 큐
const queue: AnalyticsPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

export type AnalyticsEventType =
  | 'app_open'
  | 'screen_view'
  | 'event_impression'
  | 'event_view'
  | 'event_apply_click'
  | 'event_favorite_add'
  | 'event_favorite_remove'
  | 'alert_subscribe'
  | 'alert_unsubscribe'
  | 'filter_apply'
  | 'filter_reset'
  | 'sort_change'
  | 'company_view'
  | 'review_view'
  | 'review_click'

interface AnalyticsPayload {
  event_type: AnalyticsEventType
  event_id?: string
  company_id?: string
  device_id: string
  session_id: string
  platform: string
  properties?: Record<string, any>
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache
  try {
    let id = await AsyncStorage.getItem('@sodate_device_id')
    if (!id) {
      id = generateId()
      await AsyncStorage.setItem('@sodate_device_id', id)
    }
    deviceIdCache = id
    return id
  } catch {
    return 'unknown'
  }
}

async function flush() {
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await (supabase as any).from('analytics_events').insert(batch)
  } catch {
    // 분석 실패는 조용히 무시
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 3000) // 3초 대기 후 배치 전송
}

export async function track(
  eventType: AnalyticsEventType,
  options?: {
    eventId?: string
    companyId?: string
    properties?: Record<string, any>
  }
) {
  try {
    const deviceId = await getDeviceId()
    queue.push({
      event_type: eventType,
      event_id: options?.eventId,
      company_id: options?.companyId,
      device_id: deviceId,
      session_id: SESSION_ID,
      platform: Platform.OS,
      properties: options?.properties ?? {},
    })
    // 10개 이상 쌓이면 즉시 전송
    if (queue.length >= 10) {
      flush()
    } else {
      scheduleFlush()
    }
  } catch {
    // 추적 실패는 조용히 무시
  }
}
