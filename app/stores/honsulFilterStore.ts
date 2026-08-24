import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useState, useEffect } from 'react'

/**
 * 혼술바 필터 상태(2026-08-24, 오너 지시로 신설).
 *
 * 예전엔 로컬 useState라 화면을 나갔다 돌아오면 필터가 전부 풀렸다 — 소개팅(filterStore)·
 * 소셜링(socialingFilterStore)엔 이미 persist가 있는데 혼술바만 빠져 있던 버그.
 * myLoc(현재 좌표)은 세션마다 새로 재는 게 맞아서 여기 안 담는다(화면 로컬 state로 유지).
 *
 * hasAutoInit: 앱 설치 후 혼술바 화면에 딱 한 번 — 진입하자마자 위치 권한을 물어서
 * 허용하면 거리순, 거부하면 리뷰많은순으로 기본 정렬을 잡는다(오너 지시). 이후엔 오너가
 * 고른 정렬이 그대로 유지된다 — 매번 다시 위치를 재는 게 아니라 "최초 1회"만.
 */
interface HonsulFilterState {
  regionGroup: string | null
  sanggwon: string | null
  tag: string | null
  openNow: boolean
  sortMode: 'default' | 'distance' | 'rating' | 'reviewCount'
  hasAutoInit: boolean

  setRegionGroup: (v: string | null) => void
  setSanggwon: (v: string | null) => void
  setTag: (v: string | null) => void
  setOpenNow: (v: boolean) => void
  setSortMode: (v: HonsulFilterState['sortMode']) => void
  setHasAutoInit: (v: boolean) => void
  resetFilters: () => void
}

export const useHonsulFilterStore = create<HonsulFilterState>()(
  persist(
    (set) => ({
      regionGroup: null,
      sanggwon: null,
      tag: null,
      openNow: false,
      sortMode: 'default',
      hasAutoInit: false,

      setRegionGroup: (regionGroup) => set({ regionGroup }),
      setSanggwon: (sanggwon) => set({ sanggwon }),
      setTag: (tag) => set({ tag }),
      setOpenNow: (openNow) => set({ openNow }),
      setSortMode: (sortMode) => set({ sortMode }),
      setHasAutoInit: (hasAutoInit) => set({ hasAutoInit }),
      resetFilters: () => set({ regionGroup: null, sanggwon: null, tag: null, openNow: false }),
    }),
    {
      name: 'sodate-honsul-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)

// persist 하이드레이션 완료 여부 — 소개팅 useFilterHydrated 와 동일 패턴. hasAutoInit 을
// 읽고 나서 자동 위치요청을 트리거해야 하므로(안 그러면 매번 다시 뜬다) 반드시 기다린다.
export function useHonsulFilterHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useHonsulFilterStore.persist.hasHydrated())
  useEffect(() => {
    if (useHonsulFilterStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    const unsub = useHonsulFilterStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])
  return hydrated
}
