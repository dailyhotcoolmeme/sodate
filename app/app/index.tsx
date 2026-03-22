import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  Animated,
  Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import EventCard from '@/components/EventCard'
import EventListItem from '@/components/EventListItem'
import EventCardSkeleton from '@/components/EventCardSkeleton'
import FilterSheet from '@/components/FilterSheet'
import EmptyState from '@/components/EmptyState'
import { useEvents } from '@/hooks/useEvents'
import { useFilter } from '@/hooks/useFilter'
import { useFavorites } from '@/hooks/useFavorites'
import { useColors } from '@/hooks/useColors'
import { REGIONS } from '@/constants/regions'
import { THEMES } from '@/constants/themes'
import { useFilterStore, type FilterState } from '@/stores/filterStore'
import { track } from '@/lib/analytics'

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
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const [showFab, setShowFab] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  const router = useRouter()
  const colors = useColors()

  // 앱 오픈 트래킹
  useEffect(() => { track('app_open') }, [])
  useEffect(() => { track('screen_view', { properties: { screen_name: 'home' } }) }, [])
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // 헤더
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    logoBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    logoIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
    },
    logo: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.textPrimary,
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
      fontSize: 15,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    // 검색바
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceHigh,
      borderRadius: 14,
      marginHorizontal: 16,
      marginBottom: 10,
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    searchIcon: {
      fontSize: 15,
    },
    searchPlaceholder: {
      flex: 1,
      fontSize: 14,
      color: colors.textSecondary,
    },
    filterBadge: {
      backgroundColor: colors.primary,
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
      height: 34,
      marginBottom: 2,
    },
    regionRow: {
      paddingHorizontal: 16,
      alignItems: 'center',
      gap: 6,
    },
    regionChip: {
      paddingHorizontal: 14,
      paddingVertical: 5,
      borderRadius: 18,
      backgroundColor: colors.surfaceHigh,
      borderWidth: 1,
      borderColor: colors.border,
    },
    regionChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    regionChipText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    regionChipTextActive: {
      color: '#fff',
      fontWeight: '700',
    },
    // 테마 칩
    themeScroll: {
      height: 34,
      marginBottom: 6,
    },
    themeRow: {
      paddingHorizontal: 16,
      alignItems: 'center',
      gap: 6,
    },
    themeChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 18,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.border,
    },
    themeChipActive: {
      backgroundColor: '#FF6B9D22',
      borderColor: colors.primary,
    },
    themeChipText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    themeChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    moreFilterBtn: {
      paddingHorizontal: 14,
      paddingVertical: 5,
    },
    moreFilterText: {
      fontSize: 13,
      color: colors.primary,
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
      backgroundColor: colors.primary + '22',
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.primary + '44',
    },
    activeChipText: {
      fontSize: 12,
      color: colors.primary,
      fontWeight: '600',
    },
    activeChipX: {
      fontSize: 11,
      color: colors.primary,
      fontWeight: '700',
    },
    resetBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    resetText: {
      fontSize: 12,
      color: colors.textSecondary,
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
      color: colors.textSecondary,
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
      borderColor: colors.primary,
    },
    sortChipText: {
      fontSize: 12,
      color: colors.textTertiary,
      fontWeight: '500',
    },
    sortChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    viewToggle: {
      flexDirection: 'row',
      gap: 2,
      marginLeft: 6,
      marginRight: 4,
    },
    viewBtn: {
      width: 30,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    viewBtnActive: {
      backgroundColor: colors.surfaceHigh,
    },
    viewBtnText: {
      fontSize: 16,
      color: colors.textTertiary,
    },
    viewBtnTextActive: {
      color: colors.textPrimary,
    },
    fab: {
      position: 'absolute',
      right: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 5,
      elevation: 6,
    },
    fabIcon: {
      fontSize: 20,
      color: '#fff',
      fontWeight: '700',
      lineHeight: 24,
    },
  }), [colors])

  const scrollToTop = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
  }

  const onScroll = useCallback((e: any) => {
    setShowFab(e.nativeEvent.contentOffset.y > 300)
  }, [])

  const handleToggleFavorite = useCallback((eventId: string, companyId: string | undefined, isCurrent: boolean) => {
    track(isCurrent ? 'event_favorite_remove' : 'event_favorite_add', {
      eventId,
      companyId,
      properties: { from_screen: 'home' },
    })
    toggleFavorite(eventId)
  }, [toggleFavorite])

  const handleSortChange = useCallback((sortId: FilterState['sortBy']) => {
    track('sort_change', { properties: { sort_by: sortId } })
    setSortBy(sortId)
  }, [setSortBy])

  const handleRegionChange = useCallback((regionId: string) => {
    track('filter_apply', { properties: { region: regionId, result_count: events.length } })
    setRegion(regionId)
  }, [setRegion, events.length])

  const handleThemeToggle = useCallback((t: string) => {
    track('filter_apply', { properties: { theme: t } })
    toggleTheme(t)
  }, [toggleTheme])

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
        <TouchableOpacity style={styles.logoBtn} onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })} activeOpacity={0.7}>
          <Image source={require('../assets/logo-icon.png')} style={styles.logoIcon} contentFit="cover" />
          <Text style={styles.logo}>소개팅모아</Text>
        </TouchableOpacity>
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
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/settings')}>
            <Text style={styles.iconText}>설정</Text>
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
      <View style={styles.regionScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.regionRow}
        style={{ flex: 1 }}
      >
        {REGIONS.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={[styles.regionChip, region === r.id && styles.regionChipActive]}
            onPress={() => handleRegionChange(r.id)}
          >
            <Text style={[styles.regionChipText, region === r.id && styles.regionChipTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>

      {/* ── 테마 빠른 칩 ── */}
      <View style={styles.themeScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.themeRow}
        style={{ flex: 1 }}
      >
        {QUICK_THEMES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.themeChip, themes.includes(t) && styles.themeChipActive]}
            onPress={() => handleThemeToggle(t)}
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
      </View>

      {/* ── 활성 필터 칩 + 초기화 ── */}
      {activeChips.length > 0 && (
        <View style={styles.activeFilterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
            {activeChips.map((chip, i) => (
              <TouchableOpacity key={i} style={styles.activeChip} onPress={chip.onRemove}>
                <Text style={styles.activeChipText}>{chip.label}</Text>
                <Ionicons name="close" size={11} color={colors.primary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={resetFilters} style={styles.resetBtn}>
            <Text style={styles.resetText}>초기화</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 결과 수 + 정렬 + 뷰 토글 ── */}
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
              onPress={() => handleSortChange(opt.id)}
            >
              <Text style={[styles.sortChipText, sortBy === opt.id && styles.sortChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.viewBtn, viewMode === 'card' && styles.viewBtnActive]}
            onPress={() => setViewMode('card')}
          >
            <Ionicons name="grid-outline" size={18} color={viewMode === 'card' ? colors.textPrimary : colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
            onPress={() => setViewMode('list')}
          >
            <Ionicons name="list-outline" size={18} color={viewMode === 'list' ? colors.textPrimary : colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── 이벤트 리스트 ── */}
      {loading ? (
        <View style={{ flex: 1 }}>
          {[1, 2, 3].map((i) => <EventCardSkeleton key={i} />)}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          onScroll={onScroll}
          scrollEventThrottle={100}
          data={events}
          renderItem={({ item }) => viewMode === 'card' ? (
            <EventCard
              event={item}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id, item.company_id ?? undefined, favoriteIds.has(item.id))}
            />
          ) : (
            <EventListItem
              event={item}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id, item.company_id ?? undefined, favoriteIds.has(item.id))}
            />
          )}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />

      {/* ── 맨위로 FAB ── */}
      {showFab && (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={scrollToTop} activeOpacity={0.85}>
          <Ionicons name="chevron-up" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  )
}
