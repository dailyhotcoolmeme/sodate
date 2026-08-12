import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface FilterSnapshot {
  id: string
  regions: string[]
  dateStart: string | null
  dateEnd: string | null
  maxPrice: number | null
  themes: string[]
  hashtags?: string[]
  savedAt: number
}

interface FilterState {
  regions: string[]
  // 관심 기간(날짜 범위) — 'YYYY-MM-DD', 미설정 시 null(기간 제한 없음).
  dateStart: string | null
  dateEnd: string | null
  maxPrice: number | null
  themes: string[]
  hashtags: string[]      // 해시태그 (예: '#와인') — OR 필터
  ageGroups: string[]
  days: number[]          // 요일 0=일 ~ 6=토
  timeSlots: string[]     // 시간대 morning|afternoon|evening|night
  companies: string[]     // 업체 company_id
  sortBy: 'date' | 'deadline' | 'created' | 'price_low' | 'price_high'
  excludeClosed: boolean   // 마감(is_closed) 이벤트 목록에서 제외
  recentFilters: FilterSnapshot[]

  toggleRegion: (id: string) => void
  setRegionsBulk: (ids: string[], on: boolean) => void
  setDateRange: (start: string | null, end: string | null) => void
  setMaxPrice: (price: number | null) => void
  toggleTheme: (theme: string) => void
  toggleHashtag: (tag: string) => void
  setHashtags: (tags: string[]) => void
  clearHashtags: () => void
  toggleAgeGroup: (id: string) => void
  toggleDay: (d: number) => void
  toggleTimeSlot: (s: string) => void
  toggleCompany: (id: string) => void
  setSortBy: (sort: FilterState['sortBy']) => void
  setExcludeClosed: (v: boolean) => void
  saveRecentFilter: () => void
  applyRecentFilter: (snapshot: FilterSnapshot) => void
  resetFilters: () => void
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      regions: [],
      dateStart: null,
      dateEnd: null,
      maxPrice: null,
      themes: [],
      hashtags: [],
      ageGroups: [],
      days: [],
      timeSlots: [],
      companies: [],
      sortBy: 'date',
      excludeClosed: false,
      recentFilters: [],

      toggleRegion: (id) =>
        set((s) => ({
          regions: s.regions.includes(id)
            ? s.regions.filter((x) => x !== id)
            : [...s.regions, id],
        })),
      // 여러 지역을 한번에 추가/제거(홈 지역 '군' 칩용)
      setRegionsBulk: (ids, on) =>
        set((s) => ({
          regions: on
            ? Array.from(new Set([...s.regions, ...ids]))
            : s.regions.filter((x) => !ids.includes(x)),
        })),
      setDateRange: (dateStart, dateEnd) => set({ dateStart, dateEnd }),
      setMaxPrice: (maxPrice) => set({ maxPrice }),
      toggleTheme: (theme) =>
        set((s) => ({
          themes: s.themes.includes(theme)
            ? s.themes.filter((t) => t !== theme)
            : [...s.themes, theme],
        })),
      toggleHashtag: (tag) =>
        set((s) => ({
          hashtags: s.hashtags.includes(tag)
            ? s.hashtags.filter((t) => t !== tag)
            : [...s.hashtags, tag],
        })),
      setHashtags: (hashtags) => set({ hashtags }),
      clearHashtags: () => set({ hashtags: [] }),
      toggleAgeGroup: (id) =>
        set((s) => ({
          ageGroups: s.ageGroups.includes(id)
            ? s.ageGroups.filter((x) => x !== id)
            : [...s.ageGroups, id],
        })),
      toggleDay: (d) =>
        set((s) => ({
          days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d],
        })),
      toggleTimeSlot: (slot) =>
        set((s) => ({
          timeSlots: s.timeSlots.includes(slot)
            ? s.timeSlots.filter((x) => x !== slot)
            : [...s.timeSlots, slot],
        })),
      toggleCompany: (id) =>
        set((s) => ({
          companies: s.companies.includes(id)
            ? s.companies.filter((x) => x !== id)
            : [...s.companies, id],
        })),
      setSortBy: (sortBy) => set({ sortBy }),
      setExcludeClosed: (excludeClosed) => set({ excludeClosed }),

      saveRecentFilter: () => {
        const { regions, dateStart, dateEnd, maxPrice, themes, hashtags, recentFilters } = get()
        const snapshot: FilterSnapshot = {
          id: Date.now().toString(),
          regions,
          dateStart,
          dateEnd,
          maxPrice,
          themes,
          hashtags,
          savedAt: Date.now(),
        }
        const updated = [snapshot, ...recentFilters].slice(0, 5)
        set({ recentFilters: updated })
      },

      applyRecentFilter: (snapshot) =>
        set({
          regions: snapshot.regions ?? [],
          dateStart: snapshot.dateStart ?? null,
          dateEnd: snapshot.dateEnd ?? null,
          maxPrice: snapshot.maxPrice,
          themes: snapshot.themes,
          hashtags: snapshot.hashtags ?? [],
        }),

      resetFilters: () =>
        set({
          regions: [],
          dateStart: null,
          dateEnd: null,
          maxPrice: null,
          themes: [],
          hashtags: [],
          ageGroups: [],
          days: [],
          timeSlots: [],
          companies: [],
          sortBy: 'date',
          excludeClosed: false,
        }),
    }),
    {
      name: 'sodate-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)

export type { FilterSnapshot, FilterState }

// persist(AsyncStorage) 하이드레이션 완료 여부 — 완료 전 필터 UI를 렌더하면
// 기본값(전체)이 잠깐 보였다 저장값으로 바뀌는 깜빡임이 생김. 이걸로 게이트.
import { useState, useEffect } from 'react'
export function useFilterHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useFilterStore.persist.hasHydrated())
  useEffect(() => {
    if (useFilterStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    const unsub = useFilterStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])
  return hydrated
}
