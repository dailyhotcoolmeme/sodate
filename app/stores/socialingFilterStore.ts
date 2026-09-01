import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useState, useEffect } from 'react'

/**
 * 소셜링 전용 필터 상태(2026-08-22, 오너 승인).
 *
 * 소개팅(filterStore)과 데이터 축이 달라 필터도 다르게 간다 — 소셜링은 나이·성비·테마·업체
 * 필터가 없고(나이 데이터 0%, 트레바리 성비 없음), 대신 **카테고리**가 축이다. 두 화면이
 * 같은 스토어를 쓰면 탭을 오갈 때 지역·가격 필터가 서로 새어나가므로 완전히 분리한다.
 *   - groups     : 통합 카테고리 그룹 key(constants/socialingCategories). 다중.
 *   - regions    : location_region 문자열(소개팅과 동일 다중 선택)
 *   - maxPrice   : 가격 상한(원)
 *   - days       : 요일 0=일 ~ 6=토
 * 정렬·마감제외도 소셜링용으로 따로 둔다. draft 패턴은 소개팅 FilterSheet와 동일.
 */
interface SocialingFilterState {
  groups: string[]
  regions: string[]
  minPrice: number | null
  maxPrice: number | null
  days: number[]
  sortBy: 'date' | 'created' | 'price_low' | 'price_high'
  excludeClosed: boolean

  toggleGroup: (key: string) => void
  toggleRegion: (id: string) => void
  setRegionsBulk: (ids: string[], on: boolean) => void
  setMinPrice: (price: number | null) => void
  setMaxPrice: (price: number | null) => void
  toggleDay: (d: number) => void
  setSortBy: (sort: SocialingFilterState['sortBy']) => void
  setExcludeClosed: (v: boolean) => void
  applyDraft: (draft: {
    groups: string[]
    regions: string[]
    minPrice: number | null
    maxPrice: number | null
    days: number[]
  }) => void
  resetFilters: () => void
}

export const useSocialingFilterStore = create<SocialingFilterState>()(
  persist(
    (set) => ({
      groups: [],
      regions: [],
      minPrice: null,
      maxPrice: null,
      days: [],
      sortBy: 'date',
      excludeClosed: false,

      toggleGroup: (key) =>
        set((s) => ({
          groups: s.groups.includes(key) ? s.groups.filter((x) => x !== key) : [...s.groups, key],
        })),
      toggleRegion: (id) =>
        set((s) => ({
          regions: s.regions.includes(id) ? s.regions.filter((x) => x !== id) : [...s.regions, id],
        })),
      setRegionsBulk: (ids, on) =>
        set((s) => ({
          regions: on
            ? Array.from(new Set([...s.regions, ...ids]))
            : s.regions.filter((x) => !ids.includes(x)),
        })),
      setMinPrice: (minPrice) => set({ minPrice }),
      setMaxPrice: (maxPrice) => set({ maxPrice }),
      toggleDay: (d) =>
        set((s) => ({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] })),
      setSortBy: (sortBy) => set({ sortBy }),
      setExcludeClosed: (excludeClosed) => set({ excludeClosed }),
      // FilterSheet 초안을 "적용하기" 눌렀을 때 한 번만 커밋(소개팅과 동일 이유: 칩 탭마다
      // 네트워크 요청 쏘는 것 방지).
      applyDraft: (draft) => set(draft),
      resetFilters: () =>
        set({ groups: [], regions: [], minPrice: null, maxPrice: null, days: [], sortBy: 'date', excludeClosed: false }),
    }),
    {
      name: 'sodate-socialing-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)

export type { SocialingFilterState }

// persist 하이드레이션 완료 여부 — 소개팅 useFilterHydrated 와 동일 패턴.
export function useSocialingFilterHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useSocialingFilterStore.persist.hasHydrated())
  useEffect(() => {
    if (useSocialingFilterStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    const unsub = useSocialingFilterStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])
  return hydrated
}

// 활성 필터 개수(필터 버튼 배지용)
export function socialingActiveFilterCount(s: Pick<SocialingFilterState, 'groups' | 'regions' | 'minPrice' | 'maxPrice' | 'days'>): number {
  return [
    s.groups.length > 0 ? 1 : 0,
    s.regions.length > 0 ? 1 : 0,
    s.minPrice !== null || s.maxPrice !== null ? 1 : 0,
    s.days.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0)
}
