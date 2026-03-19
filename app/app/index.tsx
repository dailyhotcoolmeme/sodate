import { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  TextInput,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import EventCard from '@/components/EventCard'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import FilterSheet from '@/components/FilterSheet'
import EmptyState from '@/components/EmptyState'
import { useEvents } from '@/hooks/useEvents'
import { useFilter } from '@/hooks/useFilter'
import { useFavorites } from '@/hooks/useFavorites'
import { Colors } from '@/constants/colors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { useFilterStore, type FilterState } from '@/stores/filterStore'

type SortOption = { id: FilterState['sortBy']; label: string }
const SORT_OPTIONS: SortOption[] = [
  { id: 'date', label: '날짜순' },
  { id: 'deadline', label: '마감 임박' },
  { id: 'price_low', label: '가격 낮은순' },
  { id: 'price_high', label: '가격 높은순' },
  { id: 'created', label: '최신 등록' },
]

const QUICK_THEMES = ['프리미엄', '직장인', '야외', '취미', '액티비티']

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { events, loading, refetch } = useEvents()
  const [filterVisible, setFilterVisible] = useState(false)
  const { region, themes, maxPrice, dateRange, activeFilterCount, regionLabel, setRegion, toggleTheme, resetFilters } = useFilter()
  const { sortBy, setSortBy } = useFilterStore()
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()
  const router = useRouter()

  const activeChips: { label: string; onRemove: () => void }[] = []
  if (region !== 'all') activeChips.push({ label: regionLabel, onRemove: () => setRegion('all') })
  themes.forEach((t) => {
    const label = THEMES.find((th) => th.id === t)?.label ?? t
    activeChips.push({ label, onRemove: () => toggleTheme(t) })
  })
  if (maxPrice !== null) activeChips.push({ label: `${(maxPrice / 10000).toFixed(0)}만원 이하`, onRemove: () => useFilterStore.getState().setMaxPrice(null) })
  if (dateRange !== 'all') {
    const dl = dateRange === 'today' ? '오늘' : dateRange === 'week' ? '1주일' : '1달'
    activeChips.push({ label: dl, onRemove: () => useFilterStore.getState().setDateRange('all') })
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── 상단 헤더 ── */}
      <View style={styles.header}>
        <Text style={styles.logo}>소개팅모아</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/reviews')}>
            <Text style={styles.iconText}>후기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/favorites')}>
            <Text style={styles.iconText}>관심</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/alerts')}>
            <Text style={styles.iconText}>알림</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── 검색바 (탭하면 필터 시트 오픈) ── */}
      <TouchableOpacity
        style={styles.searchBar}
        activeOpacity={0.7}
        onPress={() => setFilterVisible(true)}
      >
        <Text style={styles.searchIcon}>검색</Text>
        <Text style={styles.searchPlaceholder}>
          {activeFilterCount > 0
            ? `필터 ${activeFilterCount}개 적용 중`
            : '지역 · 테마 · 가격으로 검색'}
        </Text>
        {activeFilterCount > 0 && (
          <View style={styles.filterBadge}>
            <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
          </View>
        )}
        <Text style={styles.filterIcon}>›</Text>
      </TouchableOpacity>

      {/* ── 지역 빠른 탭 ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.regionRow}
        style={styles.regionScroll}
      >
        {REGIONS.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={[styles.regionChip, region === r.id && styles.regionChipActive]}
            onPress={() => setRegion(r.id)}
          >
            <Text style={[styles.regionChipText, region === r.id && styles.regionChipTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── 테마 빠른 칩 ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.themeRow}
        style={styles.themeScroll}
      >
        {QUICK_THEMES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.themeChip, themes.includes(t) && styles.themeChipActive]}
            onPress={() => toggleTheme(t)}
          >
            <Text style={[styles.themeChipText, themes.includes(t) && styles.themeChipTextActive]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.moreFilterBtn}
          onPress={() => setFilterVisible(true)}
        >
          <Text style={styles.moreFilterText}>더보기 ›</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── 활성 필터 칩 + 초기화 ── */}
      {activeChips.length > 0 && (
        <View style={styles.activeFilterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
            {activeChips.map((chip, i) => (
              <TouchableOpacity key={i} style={styles.activeChip} onPress={chip.onRemove}>
                <Text style={styles.activeChipText}>{chip.label}</Text>
                <Text style={styles.activeChipX}> ✕</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={resetFilters} style={styles.resetBtn}>
            <Text style={styles.resetText}>초기화</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 결과 수 + 정렬 ── */}
      <View style={styles.resultRow}>
        {!loading && (
          <Text style={styles.resultText}>
            {events.length > 0 ? `총 ${events.length}개` : '결과 없음'}
          </Text>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortRow}
          style={{ flex: 1, marginLeft: 8 }}
        >
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.sortChip, sortBy === opt.id && styles.sortChipActive]}
              onPress={() => setSortBy(opt.id)}
            >
              <Text style={[styles.sortChipText, sortBy === opt.id && styles.sortChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* ── 이벤트 리스트 ── */}
      {loading ? (
        <View style={{ flex: 1 }}>
          {[1, 2, 3].map((i) => <EventCardSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => toggleFavorite(item.id)}
            />
          )}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={Colors.primary} />
          }
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logo: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 8,
  },
  iconText: {
    fontSize: 18,
  },
  // 검색바
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceHigh,
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchIcon: {
    fontSize: 15,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  filterBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
  filterIcon: {
    fontSize: 14,
  },
  // 지역 탭
  regionScroll: {
    maxHeight: 44,
    marginBottom: 2,
  },
  regionRow: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  regionChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  regionChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  regionChipText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  regionChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  // 테마 칩
  themeScroll: {
    maxHeight: 40,
    marginTop: 6,
    marginBottom: 4,
  },
  themeRow: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  themeChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  themeChipActive: {
    backgroundColor: '#FF6B9D22',
    borderColor: Colors.primary,
  },
  themeChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  themeChipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  moreFilterBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  moreFilterText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  // 활성 필터
  activeFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 8,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary + '22',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  activeChipText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  activeChipX: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '700',
  },
  resetBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resetText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  // 결과 수 + 정렬
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 6,
  },
  resultText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    minWidth: 48,
  },
  sortRow: {
    gap: 6,
    alignItems: 'center',
    paddingRight: 12,
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sortChipActive: {
    backgroundColor: '#FF6B9D18',
    borderColor: Colors.primary,
  },
  sortChipText: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '500',
  },
  sortChipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
})
