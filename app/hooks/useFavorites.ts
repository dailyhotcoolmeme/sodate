import { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import * as Application from 'expo-application'

const DEVICE_ID_KEY = 'sodate-device-id'

async function getDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored

  let id: string
  try {
    id = Application.getAndroidId()
  } catch {
    id = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  await AsyncStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

export function useFavorites() {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        const id = await getDeviceId()
        setDeviceId(id)
        const { data } = await supabase
          .from('favorites')
          .select('event_id')
          .eq('device_id', id)
        setFavoriteIds(new Set((data ?? []).map((r: any) => r.event_id)))
      } catch {
        // 실패해도 스피너는 내린다(관심목록은 비어 보이되 앱은 정상)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  const toggle = useCallback(async (eventId: string) => {
    if (!deviceId) return
    const isFav = favoriteIds.has(eventId)

    // 낙관적 업데이트
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (isFav) next.delete(eventId)
      else next.add(eventId)
      return next
    })

    try {
      if (isFav) {
        await supabase
          .from('favorites')
          .delete()
          .eq('device_id', deviceId)
          .eq('event_id', eventId)
      } else {
        await supabase
          .from('favorites')
          .insert({ device_id: deviceId, event_id: eventId } as any)
      }
    } catch {
      // 쓰기 실패 시 낙관적 업데이트 롤백(로컬-서버 desync 방지)
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(eventId)
        else next.delete(eventId)
        return next
      })
    }
  }, [deviceId, favoriteIds])

  return { favoriteIds, toggle, loading, deviceId }
}

export function useFavoriteEvents() {
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { deviceId } = useFavorites()

  useEffect(() => {
    if (!deviceId) return
    setLoading(true)
    supabase
      .from('favorites')
      .select('event_id, events(*, companies(id, name, logo_url, slug, base_url, description, is_active, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at))')
      .eq('device_id', deviceId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEvents((data ?? []).map((r: any) => r.events).filter(Boolean))
        setLoading(false)
      }, () => setLoading(false))
  }, [deviceId])

  return { events, loading }
}
