import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getCachedPushToken } from '@/lib/pushToken'
import { useNotificationStore } from '@/stores/notificationStore'

export interface NotificationRow {
  id: string
  token: string
  event_id: string | null
  type: string | null
  title: string | null
  body: string | null
  location_region: string | null
  company_name: string | null
  source_url: string | null
  read: boolean
  created_at: string
}

/** 이 기기(푸시 토큰)로 받은 알림 내역 + 읽음 처리 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const token = await getCachedPushToken()
    if (!token) {
      setItems([])
      setLoading(false)
      return
    }
    const { data } = await (supabase.rpc as any)('get_my_notifications', { p_token: token, p_limit: 100 })
    setItems((data ?? []) as NotificationRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const markAllRead = useCallback(async () => {
    useNotificationStore.getState().setUnread(0) // 종 배지 즉시 0
    const token = await getCachedPushToken()
    if (!token) return
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    await (supabase.rpc as any)('mark_notifications_read', { p_token: token })
  }, [])

  const deleteOne = useCallback(async (id: string) => {
    const token = await getCachedPushToken()
    if (!token) return
    setItems((prev) => prev.filter((n) => n.id !== id))
    await (supabase.rpc as any)('delete_notification', { p_token: token, p_id: id })
    useNotificationStore.getState().refreshUnread()
  }, [])

  const deleteAll = useCallback(async () => {
    const token = await getCachedPushToken()
    if (!token) return
    setItems([])
    await (supabase.rpc as any)('delete_all_notifications', { p_token: token })
    useNotificationStore.getState().setUnread(0)
  }, [])

  return { items, loading, refetch: load, markAllRead, deleteOne, deleteAll }
}

/** 톱바 종 뱃지용 — 안 읽은 알림 개수만 가볍게 조회 */
export function useUnreadNotificationCount(refreshKey?: unknown): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const token = await getCachedPushToken()
      if (!token) return
      const { data } = await (supabase.rpc as any)('get_unread_notification_count', { p_token: token })
      if (alive && typeof data === 'number') setCount(data)
    })()
    return () => {
      alive = false
    }
  }, [refreshKey])

  return count
}
