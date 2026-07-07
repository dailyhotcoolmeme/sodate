import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface FilterSnapshot {
  id: string
  regions: string[]
  dateRange: string
  maxPrice: number | null
  themes: string[]
  hashtags?: string[]
  savedAt: number
}

interface FilterState {
  regions: string[]
  dateRange: 'all' | 'today' | 'week' | 'month'
  maxPrice: number | null
  themes: string[]
  hashtags: string[]      // 해시태그 (예: '#와인') — OR 필터
  ageGroups: string[]
  days: number[]          // 요일 0=일 ~ 6=토
  timeSlots: string[]     // 시간대 morning|afternoon|evening|night
  companies: string[]     // 업체 company_id
  sortBy: 'date' | 'deadline' | 'created' | 'price_low' | 'price_high'
  recentFilters: FilterSnapshot[]

  toggleRegion: (id: string) => void
  setRegionsBulk: (ids: string[], on: boolean) => void
  setDateRange: (range: FilterState['dateRange']) => void
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
  saveRecentFilter: () => void
  applyRecentFilter: (snapshot: FilterSnapshot) => void
  resetFilters: () => void
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      regions: [],
      dateRange: 'all',
      maxPrice: null,
      themes: [],
      hashtags: [],
      ageGroups: [],
      days: [],
      timeSlots: [],
      companies: [],
      sortBy: 'date',
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
      setDateRange: (dateRange) => set({ dateRange }),
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

      saveRecentFilter: () => {
        const { regions, dateRange, maxPrice, themes, hashtags, recentFilters } = get()
        const snapshot: FilterSnapshot = {
          id: Date.now().toString(),
          regions,
          dateRange,
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
          dateRange: snapshot.dateRange as FilterState['dateRange'],
          maxPrice: snapshot.maxPrice,
          themes: snapshot.themes,
          hashtags: snapshot.hashtags ?? [],
        }),

      resetFilters: () =>
        set({
          regions: [],
          dateRange: 'all',
          maxPrice: null,
          themes: [],
          hashtags: [],
          ageGroups: [],
          days: [],
          timeSlots: [],
          companies: [],
          sortBy: 'date',
        }),
    }),
    {
      name: 'sodate-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)

export type { FilterSnapshot, FilterState }
