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
        // favorites 테이블은 anon 직접 접근이 막혀 있다(예전엔 정책이 USING(true)라
        // 누구나 전체 조회·삭제가 가능했음 — 2026-07-28 실증). device_id로 스코핑된 RPC만 사용.
        const { data } = await supabase.rpc('get_my_favorite_ids' as any, { p_device_id: id } as any)
        setFavoriteIds(new Set((data ?? []) as string[]))
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
      const { error } = await supabase.rpc('set_favorite' as any, {
        p_device_id: deviceId, p_event_id: eventId, p_on: !isFav,
      } as any)
      if (error) throw error
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
  const [error, setError] = useState<string | null>(null)
  const { deviceId } = useFavorites()

  const fetchFavorites = useCallback(async () => {
    if (!deviceId) return
    setLoading(true)
    setError(null)
    try {
      // 이벤트+업체를 조인해 jsonb 배열로 돌려주는 스코핑 RPC(테이블 직접 접근은 차단됨).
      const { data, error: err } = await supabase.rpc('get_my_favorite_events' as any, {
        p_device_id: deviceId,
      } as any)
      if (err) throw err
      setEvents((data ?? []) as any[])
    } catch (e: unknown) {
      // 예전엔 실패해도 빈 배열이라 "찜한 게 없음"과 구분이 안 돼, 사용자는 찜이
      // 사라진 줄 알았다. 에러를 분리해 화면에서 재시도를 띄운다.
      setError(e instanceof Error ? e.message : '불러오지 못했어요')
    } finally {
      setLoading(false)
    }
  }, [deviceId])

  useEffect(() => { fetchFavorites() }, [fetchFavorites])

  return { events, loading, error, refetch: fetchFavorites }
}
