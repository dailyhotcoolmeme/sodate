import { useFilterStore } from '@/stores/filterStore'
import type { FilterSnapshot } from '@/stores/filterStore'

// AsyncStorage mock (zustand persist 비활성화)
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
)

const reset = () => {
  useFilterStore.getState().resetFilters()
  useFilterStore.setState({ recentFilters: [] })
}

describe('filterStore', () => {
  beforeEach(reset)

  // --- 기본값 ---
  it('기본값이 올바르게 설정된다', () => {
    const state = useFilterStore.getState()
    expect(state.region).toBe('all')
    expect(state.dateRange).toBe('all')
    expect(state.maxPrice).toBeNull()
    expect(state.themes).toEqual([])
    expect(state.sortBy).toBe('date')
  })

  // --- setRegion ---
  it('setRegion 호출 시 region이 변경된다', () => {
    useFilterStore.getState().setRegion('강남')
    expect(useFilterStore.getState().region).toBe('강남')
  })

  // --- setDateRange ---
  it('setDateRange 호출 시 dateRange가 변경된다', () => {
    useFilterStore.getState().setDateRange('week')
    expect(useFilterStore.getState().dateRange).toBe('week')
  })

  // --- setMaxPrice ---
  it('setMaxPrice 호출 시 maxPrice가 변경된다', () => {
    useFilterStore.getState().setMaxPrice(50000)
    expect(useFilterStore.getState().maxPrice).toBe(50000)
  })

  it('setMaxPrice(null) 호출 시 maxPrice가 null이 된다', () => {
    useFilterStore.getState().setMaxPrice(50000)
    useFilterStore.getState().setMaxPrice(null)
    expect(useFilterStore.getState().maxPrice).toBeNull()
  })

  // --- toggleTheme ---
  it('toggleTheme으로 테마를 추가할 수 있다', () => {
    useFilterStore.getState().toggleTheme('와인')
    expect(useFilterStore.getState().themes).toContain('와인')
  })

  it('toggleTheme을 두 번 호출하면 테마가 제거된다', () => {
    useFilterStore.getState().toggleTheme('와인')
    useFilterStore.getState().toggleTheme('와인')
    expect(useFilterStore.getState().themes).not.toContain('와인')
  })

  it('여러 테마를 독립적으로 추가할 수 있다', () => {
    useFilterStore.getState().toggleTheme('와인')
    useFilterStore.getState().toggleTheme('로테이션')
    const { themes } = useFilterStore.getState()
    expect(themes).toContain('와인')
    expect(themes).toContain('로테이션')
    expect(themes).toHaveLength(2)
  })

  // --- setSortBy ---
  it('setSortBy 호출 시 정렬 기준이 변경된다', () => {
    useFilterStore.getState().setSortBy('created')
    expect(useFilterStore.getState().sortBy).toBe('created')
  })

  // --- resetFilters ---
  it('resetFilters 호출 시 모든 필터가 기본값으로 돌아간다', () => {
    useFilterStore.getState().setRegion('홍대')
    useFilterStore.getState().setDateRange('week')
    useFilterStore.getState().setMaxPrice(50000)
    useFilterStore.getState().toggleTheme('와인')
    useFilterStore.getState().setSortBy('deadline')
    useFilterStore.getState().resetFilters()
    const state = useFilterStore.getState()
    expect(state.region).toBe('all')
    expect(state.dateRange).toBe('all')
    expect(state.maxPrice).toBeNull()
    expect(state.themes).toEqual([])
    expect(state.sortBy).toBe('date')
  })

  // --- saveRecentFilter ---
  it('saveRecentFilter 호출 시 현재 필터가 recentFilters에 저장된다', () => {
    useFilterStore.getState().setRegion('강남')
    useFilterStore.getState().toggleTheme('와인')
    useFilterStore.getState().saveRecentFilter()
    const { recentFilters } = useFilterStore.getState()
    expect(recentFilters).toHaveLength(1)
    expect(recentFilters[0].region).toBe('강남')
    expect(recentFilters[0].themes).toContain('와인')
  })

  it('최근 필터는 최대 5개까지만 저장된다', () => {
    for (let i = 0; i < 7; i++) {
      useFilterStore.getState().setRegion(`region-${i}`)
      useFilterStore.getState().saveRecentFilter()
    }
    expect(useFilterStore.getState().recentFilters).toHaveLength(5)
  })

  it('최신 필터가 recentFilters 맨 앞에 위치한다', () => {
    useFilterStore.getState().setRegion('강남')
    useFilterStore.getState().saveRecentFilter()
    useFilterStore.getState().setRegion('홍대')
    useFilterStore.getState().saveRecentFilter()
    expect(useFilterStore.getState().recentFilters[0].region).toBe('홍대')
  })

  // --- applyRecentFilter ---
  it('applyRecentFilter 호출 시 스냅샷 값이 적용된다', () => {
    const snapshot: FilterSnapshot = {
      id: 'snap-1',
      region: '이태원',
      dateRange: 'month',
      maxPrice: 30000,
      themes: ['파티'],
      savedAt: Date.now(),
    }
    useFilterStore.getState().applyRecentFilter(snapshot)
    const state = useFilterStore.getState()
    expect(state.region).toBe('이태원')
    expect(state.dateRange).toBe('month')
    expect(state.maxPrice).toBe(30000)
    expect(state.themes).toContain('파티')
  })
})
