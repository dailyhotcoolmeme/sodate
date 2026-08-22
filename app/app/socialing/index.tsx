import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import SocialingListItem from '@/components/SocialingListItem'
import SocialingCard from '@/components/SocialingCard'
import EventSearchModal from '@/components/EventSearchModal'
import SocialingFilterSheet from '@/components/SocialingFilterSheet'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useEvents } from '@/hooks/useEvents'
import { useFavorites } from '@/hooks/useFavorites'
import { useRegions } from '@/hooks/useRegions'
import { REGION_GROUP_ORDER, regionGroupKey } from '@/constants/chipGroups'
import { SOCIALING_GROUPS } from '@/constants/socialingCategories'
import { useSocialingFilterStore, useSocialingFilterHydrated, socialingActiveFilterCount, type SocialingFilterState } from '@/stores/socialingFilterStore'
import { addRecentSearch } from '@/lib/eventSearchHistory'

/**
 * 소셜링 목록 화면(2026-08-21~08-22, 오너 승인). 소개팅 피드와 같은 틀이되 필터 축이 다르다:
 * 소개팅=나이대, 소셜링=카테고리. 헤더 빠른칩 = 카테고리(다중) + 지역군, 상세는 SocialingFilterSheet
 * (지역·카테고리·가격·요일). 필터 상태는 소개팅과 완전 분리된 socialingFilterStore.
 * 데이터는 event_type='socialing'. 카드는 목록형/카드형 토글.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
const SORT_OPTIONS: { id: SocialingFilterState['sortBy']; label: string }[] = [
  { id: 'date', label: '날짜순' },
  { id: 'created', label: '최신순' },
  { id: 'price_low', label: '가격낮은순' },
  { id: 'price_high', label: '가격높은순' },
]

export default function SocialingScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [filterVisible, setFilterVisible] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')

  const hydrated = useSocialingFilterHydrated()
  const { groups, regions, maxPrice, days, sortBy, excludeClosed, toggleGroup, setRegionsBulk, setSortBy, setExcludeClosed, applyDraft, resetFilters } = useSocialingFilterStore()
  const activeFilterCount = socialingActiveFilterCount({ groups, regions, maxPrice, days })
  // '전체' 카테고리 칩 = 카테고리만 비운다(지역·가격·요일·정렬은 유지).
  const clearGroups = useCallback(() => {
    if (groups.length > 0) applyDraft({ groups: [], regions, maxPrice, days })
  }, [applyDraft, groups.length, regions, maxPrice, days])

  const { events, loading, loadingMore, refetch, loadMore } = useEvents(search, 'socialing')
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  // 지역 빠른탭 = 군(강남권·강북권…) — 소개팅과 동일 계산.
  const regionOptions = useRegions()
  const regionGroupChips = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r.id)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ key: g.key, ids: buckets[g.key] }))
  }, [regionOptions])

  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const runSearch = (term: string) => { setSearch(term); addRecentSearch(term) }
  const clearSearch = () => setSearch('')

  const isEmpty = !loading && events.length === 0
  const anyFilterActive = activeFilterCount > 0 || !!search

  return (
    <View style={styles.container}>
      <TopBar onSearchPress={() => setSearchVisible(true)} />

      {/* ── 카테고리 빠른칩(다중) ── */}
      <View style={styles.catBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar} style={{ flex: 1 }}>
          <Chip label="전체" active={groups.length === 0} onPress={clearGroups} colors={colors} />
          {SOCIALING_GROUPS.map((g) => (
            <Chip key={g.key} label={g.label} active={groups.includes(g.key)} onPress={() => toggleGroup(g.key)} colors={colors} />
          ))}
        </ScrollView>
        <View style={styles.viewToggle}>
          <TouchableOpacity style={[styles.viewBtn, viewMode === 'card' && styles.viewBtnActive]} onPress={() => setViewMode('card')}>
            <Ionicons name="grid-outline" size={18} color={viewMode === 'card' ? colors.textPrimary : colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]} onPress={() => setViewMode('list')}>
            <Ionicons name="list-outline" size={18} color={viewMode === 'list' ? colors.textPrimary : colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── 지역 빠른탭(군) + 필터 버튼 ── */}
      <View style={styles.regionRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.regionBar} style={{ flex: 1 }}>
          {hydrated && regionGroupChips.map((g) => {
            const active = g.ids.every((id) => regions.includes(id))
            return (
              <Chip key={g.key} label={g.key} active={active} onPress={() => setRegionsBulk(g.ids, !active)} colors={colors} />
            )
          })}
        </ScrollView>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterVisible(true)} activeOpacity={0.8}>
          <Ionicons name="funnel-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.filterBtnText}>필터</Text>
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── 정렬 + 마감제외 ── */}
      <View style={styles.sortRowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortBar} style={{ flex: 1 }}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity key={opt.id} style={[styles.sortChip, sortBy === opt.id && styles.sortChipOn]} onPress={() => setSortBy(opt.id)}>
              <Text style={[styles.sortChipText, sortBy === opt.id && styles.sortChipTextOn]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.sortChip, styles.excludeChip, excludeClosed && styles.sortChipOn]} onPress={() => setExcludeClosed(!excludeClosed)}>
            <View style={[styles.checkbox, excludeClosed && styles.checkboxOn]}>
              {excludeClosed && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}
            </View>
            <Text style={[styles.sortChipText, excludeClosed && styles.sortChipTextOn]}>마감제외</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 검색/필터 활성 안내 */}
      {anyFilterActive && (
        <View style={styles.searchInfo}>
          <Text style={styles.searchInfoText} numberOfLines={1}>
            {search ? `‘${search}’ 검색 결과 ` : '필터 적용 '}{events.length}건
          </Text>
          <TouchableOpacity onPress={() => { resetFilters(); clearSearch() }} hitSlop={8}><Text style={styles.searchClear}>초기화</Text></TouchableOpacity>
        </View>
      )}

      {loading && events.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={34} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{anyFilterActive ? '조건에 맞는 모임이 없어요' : '아직 모임이 없어요'}</Text>
          <Text style={styles.emptySub}>{anyFilterActive ? '필터를 바꿔보세요' : '조금만 기다려주세요'}</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            viewMode === 'card' ? (
              <SocialingCard event={item} isFavorite={favoriteIds.has(item.id)} onToggleFavorite={() => toggleFavorite(item.id)} />
            ) : (
              <SocialingListItem event={item} isFavorite={favoriteIds.has(item.id)} onToggleFavorite={() => toggleFavorite(item.id)} />
            )
          )}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 16 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListFooterComponent={loadingMore ? <View style={styles.footer}><AppSpinner /></View> : null}
          showsVerticalScrollIndicator={false}
        />
      )}

      <BottomNav current="socialing" />
      <EventSearchModal visible={searchVisible} onClose={() => setSearchVisible(false)} onSearch={runSearch} colors={colors} />
      <SocialingFilterSheet visible={filterVisible} onClose={() => setFilterVisible(false)} />
    </View>
  )
}

function Chip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: AppColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipOn]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    catBarWrap: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
    catBar: { paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
    regionRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
    regionBar: { paddingHorizontal: 12, paddingVertical: 4, gap: 7 },
    sortRowWrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider },
    sortBar: { paddingHorizontal: 12, paddingVertical: 8, gap: 7 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    chipTextOn: { color: '#fff' },
    viewToggle: { flexDirection: 'row', gap: 2, flexShrink: 0 },
    viewBtn: { padding: 6, borderRadius: 8 },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    filterBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0,
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
    },
    filterBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    filterBadge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    filterBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    sortChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
    },
    sortChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    sortChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    sortChipTextOn: { color: '#fff' },
    excludeChip: {},
    checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    searchInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider },
    searchInfoText: { flex: 1, fontSize: 13, color: colors.textSecondary },
    searchClear: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    footer: { paddingVertical: 16 },
  })
}
