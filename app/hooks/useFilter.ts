import { useFilterStore } from '@/stores/filterStore'
import { THEMES } from '@/constants/themes'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'

export function useFilter() {
  const store = useFilterStore()

  const activeFilterCount = [
    store.regions.length > 0 ? 1 : 0,
    store.dateStart || store.dateEnd ? 1 : 0,
    store.minPrice !== null || store.maxPrice !== null ? 1 : 0,
    store.themes.length > 0 ? 1 : 0,
    store.hashtags.length > 0 ? 1 : 0,
    store.ageGroups.length > 0 ? 1 : 0,
    store.days.length > 0 ? 1 : 0,
    store.timeSlots.length > 0 ? 1 : 0,
    store.companies.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  // 지역은 동적(location_region 문자열 그대로) — id가 곧 라벨. 다중.
  const regionLabels = store.regions

  const themeLabels = store.themes.map(
    (id) => THEMES.find((t) => t.id === id)?.label ?? id
  )

  const fmtDate = (d: string) => d.slice(5).replace('-', '.')
  const dateRangeLabel =
    store.dateStart && store.dateEnd
      ? `${fmtDate(store.dateStart)}~${fmtDate(store.dateEnd)}`
      : '전체'

  const ageGroupLabels = store.ageGroups.map(
    (id) => AGE_GROUP_FILTERS.find((a) => a.id === id)?.label ?? id
  )

  return {
    ...store,
    activeFilterCount,
    regionLabels,
    themeLabels,
    dateRangeLabel,
    ageGroupLabels,
  }
}
