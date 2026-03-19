import { useFilterStore } from '@/stores/filterStore'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'

export function useFilter() {
  const store = useFilterStore()

  const activeFilterCount = [
    store.region !== 'all' ? 1 : 0,
    store.dateRange !== 'all' ? 1 : 0,
    store.maxPrice !== null ? 1 : 0,
    store.themes.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  const regionLabel =
    REGIONS.find((r) => r.id === store.region)?.label ?? '전체'

  const themeLabels = store.themes.map(
    (id) => THEMES.find((t) => t.id === id)?.label ?? id
  )

  const dateRangeLabel =
    store.dateRange === 'today'
      ? '오늘'
      : store.dateRange === 'week'
      ? '1주일'
      : store.dateRange === 'month'
      ? '1달'
      : '전체'

  return {
    ...store,
    activeFilterCount,
    regionLabel,
    themeLabels,
    dateRangeLabel,
  }
}
