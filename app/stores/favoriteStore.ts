import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import { supabase } from '@/lib/supabase'

// 관심(찜) 상태를 앱 전역에서 공유한다.
//
// 예전엔 useFavorites() 훅이 화면마다 자기 useState 를 들고 있어서, 세 화면이
// 서로 다른 목록을 봤다. 증상(2026-07-28 오너 실기기 확인):
//   · 피드에서 찜 → 상세로 들어가면 반영됨   (상세가 새로 마운트되며 서버를 다시 읽어서)
//   · 상세에서 찜 → 피드로 돌아오면 반영 안 됨 (피드는 이미 떠 있어 자기 상태 그대로)
// 덤으로 화면 진입마다 같은 RPC 를 중복 호출하고 있었다.
//
// 이제 스토어 하나만 두고 모든 화면이 그걸 본다.

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

interface FavoriteState {
  favoriteIds: Set<string>
  deviceId: string | null
  loading: boolean
  /** 앱 시작 시 1회. 여러 화면이 동시에 불러도 실제 조회는 한 번만 돈다. */
  init: () => Promise<void>
  toggle: (eventId: string) => Promise<void>
}

let initPromise: Promise<void> | null = null

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: new Set(),
  deviceId: null,
  loading: true,

  init: async () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const id = await getDeviceId()
        // favorites 테이블은 anon 직접 접근이 막혀 있다(예전엔 정책이 USING(true)라
        // 누구나 전체 조회·삭제가 가능했음). device_id 로 스코핑된 RPC 만 사용.
        const { data } = await supabase.rpc('get_my_favorite_ids' as any, { p_device_id: id } as any)
        set({ deviceId: id, favoriteIds: new Set((data ?? []) as string[]) })
      } catch {
        // 실패해도 앱은 정상 동작(관심목록만 비어 보임)
      } finally {
        set({ loading: false })
      }
    })()
    return initPromise
  },

  toggle: async (eventId) => {
    const { deviceId, favoriteIds } = get()
    if (!deviceId) return
    const isFav = favoriteIds.has(eventId)

    // 낙관적 업데이트 — 새 Set 을 만들어야 zustand 가 변경을 감지한다
    const next = new Set(favoriteIds)
    if (isFav) next.delete(eventId)
    else next.add(eventId)
    set({ favoriteIds: next })

    try {
      const { error } = await supabase.rpc('set_favorite' as any, {
        p_device_id: deviceId, p_event_id: eventId, p_on: !isFav,
      } as any)
      if (error) throw error
    } catch {
      // 쓰기 실패 시 롤백(로컬-서버 desync 방지)
      const rollback = new Set(get().favoriteIds)
      if (isFav) rollback.add(eventId)
      else rollback.delete(eventId)
      set({ favoriteIds: rollback })
    }
  },
}))
