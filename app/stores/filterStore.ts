import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface FilterSnapshot {
  id: string
  region: string
  dateRange: string
  maxPrice: number | null
  themes: string[]
  savedAt: number
}

interface FilterState {
  region: string
  dateRange: 'all' | 'today' | 'week' | 'month'
  maxPrice: number | null
  themes: string[]
  sortBy: 'date' | 'deadline' | 'created' | 'price_low' | 'price_high'
  recentFilters: FilterSnapshot[]

  setRegion: (region: string) => void
  setDateRange: (range: FilterState['dateRange']) => void
  setMaxPrice: (price: number | null) => void
  toggleTheme: (theme: string) => void
  setSortBy: (sort: FilterState['sortBy']) => void
  saveRecentFilter: () => void
  applyRecentFilter: (snapshot: FilterSnapshot) => void
  resetFilters: () => void
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      region: 'all',
      dateRange: 'all',
      maxPrice: null,
      themes: [],
      sortBy: 'date',
      recentFilters: [],

      setRegion: (region) => set({ region }),
      setDateRange: (dateRange) => set({ dateRange }),
      setMaxPrice: (maxPrice) => set({ maxPrice }),
      toggleTheme: (theme) =>
        set((s) => ({
          themes: s.themes.includes(theme)
            ? s.themes.filter((t) => t !== theme)
            : [...s.themes, theme],
        })),
      setSortBy: (sortBy) => set({ sortBy }),

      saveRecentFilter: () => {
        const { region, dateRange, maxPrice, themes, recentFilters } = get()
        const snapshot: FilterSnapshot = {
          id: Date.now().toString(),
          region,
          dateRange,
          maxPrice,
          themes,
          savedAt: Date.now(),
        }
        const updated = [snapshot, ...recentFilters].slice(0, 5)
        set({ recentFilters: updated })
      },

      applyRecentFilter: (snapshot) =>
        set({
          region: snapshot.region,
          dateRange: snapshot.dateRange as FilterState['dateRange'],
          maxPrice: snapshot.maxPrice,
          themes: snapshot.themes,
        }),

      resetFilters: () =>
        set({
          region: 'all',
          dateRange: 'all',
          maxPrice: null,
          themes: [],
          sortBy: 'date',
        }),
    }),
    {
      name: 'sodate-filter',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)

export type { FilterSnapshot }
