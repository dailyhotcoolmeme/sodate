import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import { supabase } from '@/lib/supabase'
import { useEffect } from 'react'

/**
 * 매장(혼술바) 찜 — 이벤트 찜(favoriteStore)과 같은 device_id 방식이되 별도 테이블(place_favorites).
 * 이벤트 찜과 대상이 달라(장소 vs 이벤트) 스토어를 분리한다. RPC 로만 접근(직접 테이블 차단).
 */
const DEVICE_ID_KEY = 'sodate-device-id'

async function getDeviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored
  let id: string
  try { id = Application.getAndroidId() } catch { id = `device-${Date.now()}-${Math.random().toString(36).slice(2)}` }
  await AsyncStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

interface PlaceFavState {
  favoriteIds: Set<string>
  deviceId: string | null
  loading: boolean
  init: () => Promise<void>
  toggle: (placeId: string) => Promise<void>
}

let initPromise: Promise<void> | null = null

export const usePlaceFavoriteStore = create<PlaceFavState>((set, get) => ({
  favoriteIds: new Set(),
  deviceId: null,
  loading: true,
  init: async () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const id = await getDeviceId()
        const { data } = await supabase.rpc('get_my_place_favorite_ids' as any, { p_device_id: id } as any)
        set({ deviceId: id, favoriteIds: new Set((data ?? []) as string[]) })
      } catch { /* 실패해도 앱 정상 */ } finally { set({ loading: false }) }
    })()
    return initPromise
  },
  toggle: async (placeId) => {
    const { deviceId, favoriteIds } = get()
    if (!deviceId) return
    const isFav = favoriteIds.has(placeId)
    const next = new Set(favoriteIds)
    if (isFav) next.delete(placeId); else next.add(placeId)
    set({ favoriteIds: next })
    try {
      const { error } = await supabase.rpc('set_place_favorite' as any, { p_device_id: deviceId, p_place_id: placeId, p_on: !isFav } as any)
      if (error) throw error
    } catch {
      const rollback = new Set(get().favoriteIds)
      if (isFav) rollback.add(placeId); else rollback.delete(placeId)
      set({ favoriteIds: rollback })
    }
  },
}))

export function usePlaceFavorites() {
  const favoriteIds = usePlaceFavoriteStore((s) => s.favoriteIds)
  const toggle = usePlaceFavoriteStore((s) => s.toggle)
  const init = usePlaceFavoriteStore((s) => s.init)
  useEffect(() => { init() }, [init])
  return { favoriteIds, toggle }
}
