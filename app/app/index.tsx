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
import EventCardSkeleton from '@/components/EventCardSkeleton'
import FilterSheet from '@/components/FilterSheet'
import EmptyState from '@/components/EmptyState'
import { useEvents } from '@/hooks/useEvents'
import { useFilter } from '@/hooks/useFilter'
import { useFavorites } from '@/hooks/useFavorites'
import { useColors } from '@/hooks/useColors'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey } from '@/constants/chipGroups'
import { THEMES } from '@/constants/themes'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { DAY_OPTIONS, TIME_SLOTS } from '@/constants/filters'
import { useCompanies } from '@/hooks/useCompanies'
import TopBar from '@/components/TopBar'
import { useFilterStore, type FilterState } from '@/stores/filterStore'
import { useProfileStore } from '@/stores/profileStore'
import { track } from '@/lib/analytics'

type SortOption = { id: FilterState['sortBy']; label: string }
const SORT_OPTIONS: SortOption[] = [
  { id: 'date', label: '날짜순' },
  { id: 'deadline', label: '마감 임박' },
  { id: 'price_low', label: '가격 낮은순' },
  { id: 'price_high', label: '가격 높은순' },
]

const QUICK_THEMES = ['프리미엄', '직장인', '야외', '취미', '액티비티']

// 리스트 N개마다 네이티브 광고 1개 삽입
const AD_INTERVAL = 8
type ListRow =
  | { type: 'event'; event: import('@/lib/supabase').EventWithCompany }
  | { type: 'ad'; key: string }

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { events, loading, refetch } = useEvents()
  const [filterVisible, setFilterVisible] = useState(false)
  const { regions, themes, maxPrice, dateRange, hashtags, ageGroups, days, timeSlots, companies, ageGroupLabels, activeFilterCount, regionLabels, toggleRegion, setRegionsBulk, toggleTheme, toggleHashtag, toggleAgeGroup, toggleDay, toggleTimeSlot, toggleCompany, resetFilters } = useFilter()
  const regionOptions = useRegions()

  // 홈 지역 빠른탭 = 군(강남권·강북권·강서권·경기·인천·충청·호남·경북·경남·기타) 순서
  const regionGroupChips = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r.id)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ key: g.key, ids: buckets[g.key] }))
  }, [regionOptions])
  const companyOptions = useCompanies()
  const { sortBy, setSortBy } = useFilterStore()
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()
  const { myAge, myGender, setMyAge, setMyGender } = useProfileStore()
  const [profileModalVisible, setProfileModalVisible] = useState(false)
  // 프로필 모달: 키보드 높이만큼 시트를 올려 입력칸 가림 방지
  const [profileKb, setProfileKb] = useState(0)
  useEffect(() => {
    if (!profileModalVisible) {
      setProfileKb(0)
      return
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const s = Keyboard.addListener(showEvt, (e) => setProfileKb(e.endCoordinates.height))
    const h = Keyboard.addListener(hideEvt, () => setProfileKb(0))
    return () => {
      s.remove()
      h.remove()
    }
  }, [profileModalVisible])
  const [ageInput, setAgeInput] = useState(myAge ? String(myAge) : '')
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const [showFab, setShowFab] = useState(false)
  const flatListRef = useRef<FlatList>(null)
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
    const label = companyOptions.find((c) => c.id === id)?.name ?? id
    activeChips.push({ label, onRemove: () => toggleCompany(id) })
  })
  if (maxPrice !== null) activeChips.push({ label: `${(maxPrice / 10000).toFixed(0)}만원 이하`, onRemove: () => useFilterStore.getState().setMaxPrice(null) })
  if (dateRange !== 'all') {
    const dl = dateRange === 'today' ? '오늘' : dateRange === 'week' ? '1주일' : '1달'
    activeChips.push({ label: dl, onRemove: () => useFilterStore.getState().setDateRange('all') })
  }

  // 이벤트 사이사이에 광고 슬롯 삽입
  const listData = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = []
    events.forEach((ev, i) => {
      rows.push({ type: 'event', event: ev })
      // 마지막 항목 뒤에는 광고를 넣지 않음
      if ((i + 1) % AD_INTERVAL === 0 && i < events.length - 1) {
        rows.push({ type: 'ad', key: `ad-${i}` })
      }
    })
    return rows
  }, [events])

  return (
    <View style={styles.container}>
      {/* ── 공용 톱바 ── */}
      <TopBar
        onLogoPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}
        onProfilePress={() => { setAgeInput(myAge ? String(myAge) : ''); setProfileModalVisible(true) }}
        onFilterPress={() => setFilterVisible(true)}
        filterCount={activeFilterCount}
      />

      {/* ── 지역 빠른 탭 ── */}
      <View style={styles.regionScroll}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.regionRow}
        style={{ flex: 1 }}
      >
        {regionGroupChips.map((g) => {
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
          data={listData}
          renderItem={({ item }) => {
            if (item.type === 'ad') return <AdListItem />
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
            <RefreshControl refreshing={loading} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={<EmptyState />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <FilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />

      {/* ── 내 나이/성별 설정 모달 ── */}
      <Modal
        visible={profileModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          activeOpacity={1}
          onPress={() => setProfileModalVisible(false)}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 24,
              paddingBottom: insets.bottom + 24,
              marginBottom: profileKb,
              gap: 20,
            }}
            onStartShouldSetResponder={() => true}
          >
            {/* 핸들 */}
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />

            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textPrimary }}>내 정보 설정</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: -12 }}>
              설정하면 나에게 맞는 이벤트만 보여드려요
            </Text>

            {/* 나이 입력 */}
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>내 나이</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceHigh,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.textPrimary,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                  placeholder="나이 입력 (예: 28)"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  value={ageInput}
                  onChangeText={setAgeInput}
                  maxLength={2}
                />
                {myAge !== null && (
                  <TouchableOpacity
                    onPress={() => { setAgeInput(''); setMyAge(null) }}
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, color: colors.error }}>초기화</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* 성별 선택 */}
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>성별</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {(['male', 'female'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    onPress={() => setMyGender(myGender === g ? null : g)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: 'center',
                      borderWidth: 1.5,
                      borderColor: myGender === g ? colors.primary : colors.border,
                      backgroundColor: myGender === g ? colors.primary + '22' : colors.surfaceHigh,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: myGender === g ? colors.primary : colors.textSecondary }}>
                      {g === 'male' ? '남성' : '여성'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 저장 버튼 */}
            <TouchableOpacity
              style={{
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: 'center',
              }}
              onPress={() => {
                const age = parseInt(ageInput, 10)
                setMyAge(!isNaN(age) && age > 0 && age < 100 ? age : null)
                setProfileModalVisible(false)
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>저장</Text>
            </TouchableOpacity>

            {/* 적용 중 표시 */}
            {(myAge !== null || myGender !== null) && (
              <Text style={{ fontSize: 12, color: colors.secondary, textAlign: 'center', marginTop: -8 }}>
                {[myAge !== null ? `${myAge}세` : '', myGender ? (myGender === 'male' ? '남성' : '여성') : ''].filter(Boolean).join(' · ')} 기준으로 필터링 중
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── 맨위로 FAB ── */}
      {showFab && (
        <TouchableOpacity style={[styles.fab, { bottom: insets.bottom + 20 }]} onPress={scrollToTop} activeOpacity={0.85}>
          <Ionicons name="chevron-up" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  )
}
