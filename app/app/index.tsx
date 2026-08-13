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
  Modal,
  TextInput,
  Keyboard,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import EventCard from '@/components/EventCard'
import EventListItem from '@/components/EventListItem'
import AdListItem from '@/components/AdListItem'
import AppSpinner from '@/components/AppSpinner'
import FilterSheet from '@/components/FilterSheet'
import EmptyState from '@/components/EmptyState'
import { useEvents } from '@/hooks/useEvents'
import { useFilter } from '@/hooks/useFilter'
import { useFavorites } from '@/hooks/useFavorites'
import { useColors } from '@/hooks/useColors'
import { useThemeStore } from '@/stores/themeStore'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey } from '@/constants/chipGroups'
import { THEMES } from '@/constants/themes'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { DAY_OPTIONS, TIME_SLOTS } from '@/constants/filters'
import { useCompanies } from '@/hooks/useCompanies'
import TopBar from '@/components/TopBar'
import SwipeSegment from '@/components/SwipeSegment'
import { useFilterStore, useFilterHydrated, type FilterState } from '@/stores/filterStore'
import { useProfileStore } from '@/stores/profileStore'
import { track } from '@/lib/analytics'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

type SortOption = { id: FilterState['sortBy']; label: string }
const SORT_OPTIONS: SortOption[] = [
  { id: 'date', label: '날짜순' },
  { id: 'price_low', label: '가격 낮은순' },
  { id: 'price_high', label: '가격 높은순' },
]

const QUICK_THEMES = ['프리미엄', '직장인', '야외', '취미', '액티비티']

// 리스트형: 첫 광고 3번째 뒤, 이후 AD_INTERVAL 간격
const FIRST_AD_AFTER = 3
const AD_INTERVAL = 8
// 카드형: 카드 1개가 화면을 거의 다 채워 광고 노출이 적음 → 첫 카드 바로 뒤 + 더 촘촘하게
const FIRST_AD_AFTER_CARD = 1
const AD_INTERVAL_CARD = 3
type ListRow =
  | { type: 'event'; event: import('@/lib/supabase').EventWithCompany }
  | { type: 'ad'; key: string; adIndex: number }

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { events, loading, loadingMore, error, refetch, loadMore } = useEvents()
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  const [filterVisible, setFilterVisible] = useState(false)
  const { regions, themes, maxPrice, dateStart, dateEnd, hashtags, ageGroups, days, timeSlots, companies, ageGroupLabels, activeFilterCount, regionLabels, toggleRegion, setRegionsBulk, toggleTheme, toggleHashtag, toggleAgeGroup, toggleDay, toggleTimeSlot, toggleCompany, resetFilters } = useFilter()
  const regionOptions = useRegions()
  const filterHydrated = useFilterHydrated()  // persist 로드 완료 전엔 필터칩 렌더 보류(깜빡임 방지)

  // 홈 지역 빠른탭 = 군(강남권·강북권·강서권·경기·인천·충청·호남·경북·경남·기타) 순서
  const regionGroupChips = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r.id)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ key: g.key, ids: buckets[g.key] }))
  }, [regionOptions])
  const companyOptions = useCompanies()
  const { sortBy, setSortBy, excludeClosed, setExcludeClosed } = useFilterStore()
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()
  // 내 정보(나이·성별) 시트는 전역(ProfileSheet, _layout)으로 이동 — 홈에서도 TopBar '내 정보'로 열림
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const [showFab, setShowFab] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  // 지역·나이대 칩 줄 — 스크롤하면 접히고 맨 위로 돌아오면 펼쳐진다.
  // 게시판 글쓰기 FAB와 같은 scrollY<=8 기준(2026-08-02 오너 확정, 옵션 E).
  const chipsAnim = useRef(new Animated.Value(1)).current
  const chipsExpandedRef = useRef(true)
  const router = useRouter()
  // 다른 페이지의 톱바 필터 버튼 → '/?openFilter=1' 로 진입 시 필터 시트 자동 오픈
  const { openFilter } = useLocalSearchParams<{ openFilter?: string }>()
  useEffect(() => {
    if (openFilter) {
      setFilterVisible(true)
      router.setParams({ openFilter: undefined })
    }
  }, [openFilter, router])
  const colors = useColors()
  const isDark = useThemeStore((s) => s.isDark)
  // 안드로이드는 네이티브 스크롤바 색상을 RN에서 직접 못 바꿔서(테마 리소스는 네이티브
  // 빌드에서만 적용) 다크모드에서 안 보이는 문제를 JS로 그린 커스텀 막대로 대신 표시
  const [androidScrollY, setAndroidScrollY] = useState(0)
  const [androidContentHeight, setAndroidContentHeight] = useState(0)
  const [androidListHeight, setAndroidListHeight] = useState(0)

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
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      letterSpacing: -0.3,
    },
    headerRightScroll: {
      flex: 1,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexGrow: 1,
      justifyContent: 'flex-end',
      paddingLeft: 8,
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
    headerIcons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    headerIconBtn: {
      padding: 6,
      borderRadius: 8,
    },
    headerFilterBadge: {
      position: 'absolute',
      top: 0,
      right: 0,
      minWidth: 15,
      height: 15,
      paddingHorizontal: 3,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerFilterBadgeText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '800',
    },
    menuBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.12)',
    },
    menuCard: {
      position: 'absolute',
      right: 12,
      minWidth: 168,
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    menuItemText: {
      fontSize: 15,
      color: colors.textPrimary,
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
      flexDirection: 'row',
      alignItems: 'center',
    },
    // 지역 칩과 같은 모양이어야 한다 — 여백·글자 값은 regionChip/regionChipText 를
    // 그대로 쓰고, 여기서는 줄 끝에 놓기 위한 것만 더한다(2026-07-31 오너 지적).
    filterBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      marginRight: 16, marginLeft: 4,
    },
    filterBtnBadge: {
      minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    },
    filterBtnBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
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
    // 나이대 필터 칩
    ageGroupScroll: {
      height: 34,
      marginBottom: 2,
    },
    ageGroupRow: {
      paddingHorizontal: 16,
      alignItems: 'center',
      gap: 6,
    },
    ageGroupChip: {
      paddingHorizontal: 13,
      paddingVertical: 5,
      borderRadius: 18,
      backgroundColor: colors.surfaceHigh,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ageGroupChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    ageGroupChipText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    ageGroupChipTextActive: {
      color: '#fff',
      fontWeight: '700',
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
    // 마감제외 체크칩 — 비활성은 체크박스 때문에 넓어보이지 않게 왼쪽 여백 축소(2).
    excludeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingLeft: 2,
    },
    // 활성(체크)일 때만 테두리가 생기므로 왼쪽 패딩을 오른쪽(10)과 동일하게 → 테두리가 체크박스에 붙지 않음
    excludeChipActive: {
      backgroundColor: '#FF6B9D18',
      borderColor: colors.primary,
      paddingLeft: 10,
    },
    checkbox: {
      width: 15,
      height: 15,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.textTertiary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
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
    androidScrollTrack: {
      position: 'absolute',
      right: 2,
      top: 0,
      bottom: 0,
      width: 4,
    },
    androidScrollThumb: {
      position: 'absolute',
      right: 0,
      width: 4,
      borderRadius: 2,
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

  // ⚠️(2026-08-13, 오너 지적: 필터 2줄이 스크롤 중 불안정하게 깜빡임) 예전엔 임계값이
  // y<=8 하나뿐이라 접힘/펼침 판정이 같은 선을 공유했다. 맨 위 근처에서 살짝만 흔들려도
  // (관성 감속, iOS 오버스크롤 바운스, 이미지 로드로 인한 리스트 리레이아웃 등) 그 8px
  // 선을 왔다갔다 넘나들어 애니메이션이 매번 새로 시작되며 깜빡였다. 접힘/펼침 임계값을
  // 분리해 그 사이(9~59px)를 죽은 구간으로 둬서, 경계 근처의 자잘한 흔들림으로는 상태가
  // 안 바뀌게 한다(펼치려면 8px 아래로, 접으려면 60px 넘게 — 확실히 한쪽으로 넘어가야 함).
  const EXPAND_AT = 8
  const COLLAPSE_AT = 60
  const onScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    setShowFab(y > 300)
    if (Platform.OS === 'android') setAndroidScrollY(y)
    const wasExpanded = chipsExpandedRef.current
    const expand = wasExpanded ? y <= COLLAPSE_AT : y <= EXPAND_AT
    if (expand !== wasExpanded) {
      chipsExpandedRef.current = expand
      Animated.timing(chipsAnim, { toValue: expand ? 1 : 0, duration: 200, useNativeDriver: false }).start()
    }
  }, [chipsAnim])

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
    toggleRegion(regionId)
  }, [toggleRegion, events.length])

  // 지역 '군' 칩 토글: 군에 속한 지명 전체를 한번에 선택/해제
  const handleRegionGroupToggle = useCallback((groupKey: string, ids: string[], active: boolean) => {
    track('filter_apply', { properties: { region_group: groupKey, result_count: events.length } })
    setRegionsBulk(ids, !active)
  }, [setRegionsBulk, events.length])

  const handleThemeToggle = useCallback((t: string) => {
    track('filter_apply', { properties: { theme: t } })
    toggleTheme(t)
  }, [toggleTheme])

  const handleAgeGroupChange = useCallback((groupId: string) => {
    track('filter_apply', { properties: { age_group: groupId } })
    toggleAgeGroup(groupId)
  }, [toggleAgeGroup])

  const activeChips: { label: string; onRemove: () => void }[] = []
  // 지역: 완전히 선택된 군은 군 이름 하나로 묶어 표시, 나머지는 개별
  const _remainRegions = new Set(regions)
  for (const g of regionGroupChips) {
    if (g.ids.every((id) => _remainRegions.has(id))) {
      activeChips.push({ label: g.key, onRemove: () => setRegionsBulk(g.ids, false) })
      g.ids.forEach((id) => _remainRegions.delete(id))
    }
  }
  _remainRegions.forEach((r) => activeChips.push({ label: r, onRemove: () => toggleRegion(r) }))
  hashtags.forEach((t) => activeChips.push({ label: t, onRemove: () => toggleHashtag(t) }))
  ageGroups.forEach((id) => {
    const label = AGE_GROUP_FILTERS.find((a) => a.id === id)?.label ?? id
    activeChips.push({ label, onRemove: () => toggleAgeGroup(id) })
  })
  days.forEach((d) => {
    const label = (DAY_OPTIONS.find((o) => o.id === d)?.label ?? '') + '요일'
    activeChips.push({ label, onRemove: () => toggleDay(d) })
  })
  timeSlots.forEach((s) => {
    const label = TIME_SLOTS.find((o) => o.id === s)?.label ?? s
    activeChips.push({ label, onRemove: () => toggleTimeSlot(s) })
  })
  companies.forEach((id) => {
    // 업체명이 아직 해석 안 됐으면(캐시·DB 미로드) UUID를 칩으로 노출하지 말고 생략.
    // 캐시 우선(useCompanies)이라 거의 즉시 이름으로 뜨고, 미해석 순간에도 코드가 안 보임.
    const name = companyOptions.find((c) => c.id === id)?.name
    if (!name) return
    activeChips.push({ label: name, onRemove: () => toggleCompany(id) })
  })
  if (maxPrice !== null) activeChips.push({ label: `${(maxPrice / 10000).toFixed(0)}만원 이하`, onRemove: () => useFilterStore.getState().setMaxPrice(null) })
  if (dateStart && dateEnd) {
    const fmt = (d: string) => d.slice(5).replace('-', '.')
    activeChips.push({ label: `${fmt(dateStart)}~${fmt(dateEnd)}`, onRemove: () => useFilterStore.getState().setDateRange(null, null) })
  }

  // 이벤트 사이사이에 광고 슬롯 삽입
  const listData = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = []
    // 뷰모드별 광고 간격(카드형은 첫 카드 바로 뒤 + 촘촘하게)
    const firstAfter = viewMode === 'card' ? FIRST_AD_AFTER_CARD : FIRST_AD_AFTER
    const interval = viewMode === 'card' ? AD_INTERVAL_CARD : AD_INTERVAL
    const FIRST_IDX = firstAfter - 1
    let adIndex = 0
    events.forEach((ev, i) => {
      rows.push({ type: 'event', event: ev })
      // 첫 광고는 firstAfter번째 뒤, 이후는 그로부터 interval 간격. 마지막 항목 뒤에는 안 넣음.
      const isAdSlot = i >= FIRST_IDX && (i - FIRST_IDX) % interval === 0
      if (isAdSlot && i < events.length - 1) {
        rows.push({ type: 'ad', key: `ad-${i}`, adIndex: adIndex++ })
      }
    })
    // 필터 결과가 interval보다 짧으면 위 로직이 광고를 하나도 못 넣음
    // → 결과가 2개 이상인데 광고가 없으면 결과 끝에 광고 1개 보장(수익 누락 방지)
    if (events.length >= 2 && !rows.some((r) => r.type === 'ad')) {
      rows.push({ type: 'ad', key: 'ad-tail', adIndex: adIndex++ })
    }
    return rows
  }, [events, viewMode])

  return (
    <SwipeSegment current="event">
    <View style={styles.container}>
      {/* ── 공용 톱바 ── */}
      <TopBar
        segment="event"
        onLogoPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
      />

      {/* ── 지역 빠른 탭 + 나이대 칩 — 스크롤하면 접힘(옵션 E) ── */}
      <Animated.View
        style={{
          height: chipsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 72] }),
          opacity: chipsAnim,
          overflow: 'hidden',
        }}
      >
      <View style={styles.regionScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.regionRow}
        style={{ flex: 1 }}
      >
        {filterHydrated && regionGroupChips.map((g) => {
          const active = g.ids.every((id) => regions.includes(id))
          return (
            <TouchableOpacity
              key={g.key}
              style={[styles.regionChip, active && styles.regionChipActive]}
              onPress={() => handleRegionGroupToggle(g.key, g.ids, active)}
            >
              <Text style={[styles.regionChipText, active && styles.regionChipTextActive]}>
                {g.key}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
      {/* 필터는 톱바에서 여기로 내려왔다. 톱바는 로고·소개팅/커뮤니티·메뉴만 둔다
          (2026-07-31 오너 확정). 지역 칩과 같은 줄 오른쪽 끝. */}
      <TouchableOpacity
        style={[styles.regionChip, styles.filterBtn]}
        onPress={() => setFilterVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="funnel-outline" size={13} color={colors.textSecondary} />
        <Text style={styles.regionChipText}>필터</Text>
        {activeFilterCount > 0 && (
          <View style={styles.filterBtnBadge}>
            <Text style={styles.filterBtnBadgeText}>{activeFilterCount}</Text>
          </View>
        )}
      </TouchableOpacity>
      </View>


      {/* ── 나이대 필터 칩 ── */}
      <View style={styles.ageGroupScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.ageGroupRow}
        style={{ flex: 1 }}
      >
        {AGE_GROUP_FILTERS.map((ag) => (
          <TouchableOpacity
            key={ag.id}
            style={[styles.ageGroupChip, ageGroups.includes(ag.id) && styles.ageGroupChipActive]}
            onPress={() => handleAgeGroupChange(ag.id)}
          >
            <Text style={[styles.ageGroupChipText, ageGroups.includes(ag.id) && styles.ageGroupChipTextActive]}>
              {ag.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>
      </Animated.View>

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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortRow}
          style={{ flex: 1 }}
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
          {/* 마감제외 체크칩 — 가격높은순 옆. is_closed 이벤트 숨김 */}
          <TouchableOpacity
            style={[styles.sortChip, styles.excludeChip, excludeClosed && styles.excludeChipActive]}
            onPress={() => setExcludeClosed(!excludeClosed)}
          >
            <View style={[styles.checkbox, excludeClosed && styles.checkboxOn]}>
              {excludeClosed && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}
            </View>
            <Text style={[styles.sortChipText, excludeClosed && styles.sortChipTextActive]}>
              마감제외
            </Text>
          </TouchableOpacity>
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
      {loading && events.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 100 }}>
          <AppSpinner />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
        <FlatList
          ref={flatListRef}
          onScroll={onScroll}
          onContentSizeChange={(_w, h) => { if (Platform.OS === 'android') setAndroidContentHeight(h) }}
          onLayout={(e) => { if (Platform.OS === 'android') setAndroidListHeight(e.nativeEvent.layout.height) }}
          scrollEventThrottle={100}
          data={listData}
          renderItem={({ item }) => {
            if (item.type === 'ad') return <AdListItem variant={item.adIndex % 2 === 0 ? 'thumb' : 'wide'} />
            const ev = item.event
            return viewMode === 'card' ? (
              <EventCard
                event={ev}
                isFavorite={favoriteIds.has(ev.id)}
                onToggleFavorite={() => handleToggleFavorite(ev.id, ev.company_id ?? undefined, favoriteIds.has(ev.id))}
              />
            ) : (
              <EventListItem
                event={ev}
                isFavorite={favoriteIds.has(ev.id)}
                onToggleFavorite={() => handleToggleFavorite(ev.id, ev.company_id ?? undefined, favoriteIds.has(ev.id))}
              />
            )
          }}
          keyExtractor={(item) => item.type === 'ad' ? item.key : item.event.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState error={error} onRetry={refetch} />}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 24 }}>
                <AppSpinner size={28} />
              </View>
            ) : null
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={true}
          indicatorStyle={isDark ? 'white' : 'black'}
        />
        {Platform.OS === 'android' && androidContentHeight > androidListHeight && androidListHeight > 0 && (
          <View pointerEvents="none" style={styles.androidScrollTrack}>
            <View
              style={[
                styles.androidScrollThumb,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)',
                  height: Math.max(30, (androidListHeight / androidContentHeight) * androidListHeight),
                  top:
                    (Math.min(androidScrollY, androidContentHeight - androidListHeight) /
                      (androidContentHeight - androidListHeight)) *
                    (androidListHeight - Math.max(30, (androidListHeight / androidContentHeight) * androidListHeight)),
                },
              ]}
            />
          </View>
        )}
        </View>
      )}

      <FilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />


      {/* ── 맨위로 FAB ── */}
      {showFab && (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={scrollToTop} activeOpacity={0.85}>
          <Ionicons name="chevron-up" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
    </SwipeSegment>
  )
}
