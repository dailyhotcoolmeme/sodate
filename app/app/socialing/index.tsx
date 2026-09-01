import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl, Animated } from 'react-native'
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
import { DAY_OPTIONS } from '@/constants/filters'
import { useSocialingFilterStore, useSocialingFilterHydrated, socialingActiveFilterCount, type SocialingFilterState } from '@/stores/socialingFilterStore'
import { addRecentSearch } from '@/lib/eventSearchHistory'
import { saveScrollOffset } from '@/lib/scrollMemory'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { confirmFavorite } from '@/lib/confirmToggle'
import AdListItem from '@/components/AdListItem'
import { warmNativeAdPool, getSocialingFeedNativeAdUnitId } from '@/lib/ads'
import type { EventWithCompany } from '@/lib/supabase'

/**
 * 소셜링 목록 화면(2026-08-21~08-22, 오너 승인). 소개팅 피드와 같은 틀이되 필터 축이 다르다:
 * 소개팅=나이대, 소셜링=카테고리. 헤더 빠른칩 = 카테고리(다중) + 지역군, 상세는 SocialingFilterSheet
 * (지역·카테고리·가격·요일). 필터 상태는 소개팅과 완전 분리된 socialingFilterStore.
 * 데이터는 event_type='socialing'. 카드는 목록형/카드형 토글.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
const SORT_OPTIONS: { id: SocialingFilterState['sortBy']; label: string }[] = [
  // 소개팅과 동일하게 3개 — '최신순'까지 넣으면 줄이 넘쳐 '마감제외'가 화면 밖으로 밀린다(2026-08-24).
  { id: 'date', label: '날짜순' },
  { id: 'price_low', label: '가격 낮은순' },
  { id: 'price_high', label: '가격 높은순' },
]

// 피드 사이 광고 삽입 — 소개팅(app/index.tsx)과 동일한 간격 규칙(오너 지시 2026-08-26:
// "소셜링, 혼술바에도 소개팅하고 같은 방식으로 피드 리스트에 광고배너 추가").
// 리스트형: 첫 광고 3번째 뒤, 이후 8개 간격. 카드형: 카드 1개가 화면을 거의 다 채워
// 노출이 적으므로 첫 카드 바로 뒤 + 3개 간격으로 더 촘촘하게.
const FIRST_AD_AFTER = 3
const AD_INTERVAL = 8
const FIRST_AD_AFTER_CARD = 1
const AD_INTERVAL_CARD = 3
type SocRow =
  | { type: 'event'; event: EventWithCompany }
  | { type: 'ad'; key: string; adIndex: number }

export default function SocialingScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [filterVisible, setFilterVisible] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')

  const hydrated = useSocialingFilterHydrated()
  const { groups, regions, minPrice, maxPrice, days, sortBy, excludeClosed, toggleGroup, setRegionsBulk, setSortBy, setExcludeClosed, setMinPrice, setMaxPrice, toggleDay, applyDraft, resetFilters } = useSocialingFilterStore()
  const activeFilterCount = socialingActiveFilterCount({ groups, regions, minPrice, maxPrice, days })
  const { events, loading, loadingMore, hasMore, refetch, loadMore } = useEvents(search, 'socialing')
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  // 화면 마운트 시 미리 몇 개 채워둔다(lib/ads.ts 참고) — 소개팅 피드와 동일한 이유.
  useEffect(() => { warmNativeAdPool(getSocialingFeedNativeAdUnitId(), 'socialing-feed') }, [])

  // 지역 빠른탭 = 군(강남권·강북권…) — 소개팅과 동일 계산.
  const regionOptions = useRegions('socialing')
  const regionGroupChips = useMemo(() => {
    const buckets: Record<string, string[]> = {}
    for (const r of regionOptions) (buckets[regionGroupKey(r.label)] ??= []).push(r.id)
    return REGION_GROUP_ORDER.filter((g) => buckets[g.key]?.length).map((g) => ({ key: g.key, ids: buckets[g.key] }))
  }, [regionOptions])

  // 스크롤하면 카테고리 칩 줄이 접힌다 — 소개팅과 동일(EXPAND_AT/COLLAPSE_AT 값까지 같게).
  const chipsAnim = useRef(new Animated.Value(1)).current
  const chipsExpandedRef = useRef(true)
  // 피드 스크롤 위치 기억 — 다른 탭 갔다가 돌아와도 보던 자리 그대로(2026-08-25 오너 지시).
  // 복원 로직은 hooks/useScrollRestore.ts 참고(세 번째 재설계 — 한 번만 판정하지 않고
  // 콘텐츠가 자랄 때마다 계속 다시 맞춘다). 페이지네이션 목록이라 loadMore 를 넘긴다.
  const feedListRef = useRef<FlatList>(null)
  const { restoredRef: restoredScrollRef, listVisible, onScrollBeginDrag, onContentSizeChange: restoreOnContentSizeChange } =
    useScrollRestore('socialing-feed', feedListRef, { hasMore, loadMore })
  const onFeedScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    const was = chipsExpandedRef.current
    const expand = was ? y <= 60 : y <= 8
    if (expand !== was) {
      chipsExpandedRef.current = expand
      Animated.timing(chipsAnim, { toValue: expand ? 1 : 0, duration: 200, useNativeDriver: false }).start()
    }
    // 복원이 아직 안 끝났으면 저장하지 않는다 — 마운트 직후 시스템이 자체적으로 흘리는
    // y=0 스크롤 이벤트가 먼저 도착하면 방금 복원하려던 값을 0으로 덮어써버린다.
    if (restoredScrollRef.current) saveScrollOffset('socialing-feed', y)
  }, [chipsAnim])

  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const runSearch = (term: string) => { setSearch(term); addRecentSearch(term) }
  const clearSearch = () => setSearch('')

  const isEmpty = !loading && events.length === 0

  // 이벤트 사이사이에 광고 슬롯 삽입 — 소개팅(app/index.tsx)과 동일 로직.
  const listData = useMemo<SocRow[]>(() => {
    const rows: SocRow[] = []
    const firstAfter = viewMode === 'card' ? FIRST_AD_AFTER_CARD : FIRST_AD_AFTER
    const interval = viewMode === 'card' ? AD_INTERVAL_CARD : AD_INTERVAL
    const FIRST_IDX = firstAfter - 1
    let adIndex = 0
    events.forEach((ev, i) => {
      rows.push({ type: 'event', event: ev })
      const isAdSlot = i >= FIRST_IDX && (i - FIRST_IDX) % interval === 0
      if (isAdSlot && i < events.length - 1) {
        rows.push({ type: 'ad', key: `ad-${i}`, adIndex: adIndex++ })
      }
    })
    if (events.length >= 2 && !rows.some((r) => r.type === 'ad')) {
      rows.push({ type: 'ad', key: 'ad-tail', adIndex: adIndex++ })
    }
    return rows
  }, [events, viewMode])
  const anyFilterActive = activeFilterCount > 0 || !!search

  // 적용된 필터를 제거 가능한 칩으로(소개팅과 동일). 지역은 완전선택 군은 군 이름으로 묶음.
  const activeChips: { label: string; onRemove: () => void }[] = []
  const _remain = new Set(regions)
  for (const g of regionGroupChips) {
    if (g.ids.every((id) => _remain.has(id))) {
      activeChips.push({ label: g.key, onRemove: () => setRegionsBulk(g.ids, false) })
      g.ids.forEach((id) => _remain.delete(id))
    }
  }
  _remain.forEach((id) => {
    const lbl = regionOptions.find((r) => r.id === id)?.label ?? id
    activeChips.push({ label: lbl, onRemove: () => setRegionsBulk([id], false) })
  })
  groups.forEach((k) => {
    const lbl = SOCIALING_GROUPS.find((g) => g.key === k)?.label ?? k
    activeChips.push({ label: lbl, onRemove: () => toggleGroup(k) })
  })
  days.forEach((d) => {
    const lbl = (DAY_OPTIONS.find((o) => o.id === d)?.label ?? '') + '요일'
    activeChips.push({ label: lbl, onRemove: () => toggleDay(d) })
  })
  if (minPrice !== null || maxPrice !== null) {
    const won = (n: number) => `${(n / 10000).toFixed(0)}만원`
    const priceLabel =
      minPrice !== null && maxPrice !== null ? `${won(minPrice)}~${won(maxPrice)}`
        : minPrice !== null ? `${won(minPrice)} 이상`
        : `${won(maxPrice!)} 이하`
    activeChips.push({ label: priceLabel, onRemove: () => { setMinPrice(null); setMaxPrice(null) } })
  }
  if (search) activeChips.push({ label: `‘${search}’`, onRemove: clearSearch })

  return (
    <View style={styles.container}>
      {/* ⚠️(2026-08-26) onLogoPress 를 안 넘기면 TopBar 기본 동작이 무조건 소개팅
          홈(/)으로 보낸다 — 소셜링에서 로고를 눌러도 소개팅으로 튕겼다(혼술바와 같은
          문제, 오너 지시로 함께 수정). 소개팅 홈(app/index.tsx)과 동일하게 이미 이
          화면이니 목록 맨 위로 스크롤만 해준다. */}
      <TopBar onSearchPress={() => setSearchVisible(true)} onLogoPress={() => feedListRef.current?.scrollToOffset({ offset: 0, animated: true })} />

      {/* ── 카테고리 칩 + 지역군 칩 2줄 — 소개팅처럼 스크롤하면 통째로 접힌다(마감제외
          줄만 항상 남는다). 소개팅 Animated.View 와 동일하게 두 줄을 하나로 감싼다. ── */}
      <Animated.View style={{ height: chipsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 72] }), opacity: chipsAnim, overflow: 'hidden' }}>
        <View style={styles.chipScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SOCIALING_GROUPS.map((g) => (
              <Chip key={g.key} label={g.label} active={groups.includes(g.key)} onPress={() => toggleGroup(g.key)} colors={colors} />
            ))}
          </ScrollView>
        </View>

        <View style={styles.regionScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flex: 1 }}>
            {hydrated && regionGroupChips.map((g) => {
              const active = g.ids.every((id) => regions.includes(id))
              return (
                <Chip key={g.key} label={g.key} active={active} onPress={() => setRegionsBulk(g.ids, !active)} colors={colors} />
              )
            })}
          </ScrollView>
          <TouchableOpacity style={[styles.chip, styles.filterBtn]} onPress={() => setFilterVisible(true)} activeOpacity={0.8}>
            <Ionicons name="funnel-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.chipText}>필터</Text>
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── 활성 필터 칩 + 초기화 — 소개팅과 같은 자리(정렬줄 위) ── */}
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
          <TouchableOpacity onPress={() => { resetFilters(); clearSearch() }} style={styles.resetBtn}>
            <Text style={styles.resetText}>초기화</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 정렬 + 마감제외 + 뷰토글 — 소개팅 resultRow 와 동일 ── */}
      <View style={styles.resultRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortRow} style={{ flex: 1 }}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity key={opt.id} style={[styles.sortChip, sortBy === opt.id && styles.sortChipActive]} onPress={() => setSortBy(opt.id)}>
              <Text style={[styles.sortChipText, sortBy === opt.id && styles.sortChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.sortChip, styles.excludeChip, excludeClosed && styles.excludeChipActive]} onPress={() => setExcludeClosed(!excludeClosed)}>
            <View style={[styles.checkbox, excludeClosed && styles.checkboxOn]}>
              {excludeClosed && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}
            </View>
            <Text style={[styles.sortChipText, excludeClosed && styles.sortChipTextActive]}>마감제외</Text>
          </TouchableOpacity>
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
          ref={feedListRef}
          style={{ opacity: listVisible ? 1 : 0 }}
          data={listData}
          keyExtractor={(item) => item.type === 'ad' ? item.key : item.event.id}
          renderItem={({ item }) => {
            if (item.type === 'ad') return <AdListItem slot="socialing-feed" adUnitId={getSocialingFeedNativeAdUnitId()} variant={item.adIndex % 2 === 0 ? 'thumb' : 'wide'} />
            return viewMode === 'card' ? (
              <SocialingCard event={item.event} isFavorite={favoriteIds.has(item.event.id)} onToggleFavorite={() => confirmFavorite(favoriteIds.has(item.event.id), () => toggleFavorite(item.event.id))} />
            ) : (
              <SocialingListItem event={item.event} isFavorite={favoriteIds.has(item.event.id)} onToggleFavorite={() => confirmFavorite(favoriteIds.has(item.event.id), () => toggleFavorite(item.event.id))} />
            )
          }}
          onScroll={onFeedScroll}
          onScrollBeginDrag={onScrollBeginDrag}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 16 }}
          onContentSizeChange={restoreOnContentSizeChange}
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
    // 필터 칩 줄 — 소개팅과 동일 리듬. 카테고리는 첫 줄(위 여백), 지역은 둘째 줄.
    chipScroll: { height: 34, marginBottom: 2, justifyContent: 'center' },
    regionScroll: { height: 34, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
    chipRow: { paddingHorizontal: 16, alignItems: 'center', gap: 6 },
    // 소개팅 regionChip 과 동일(pH 13, pV 5, r 18, surfaceHigh)
    chip: {
      paddingHorizontal: 13, paddingVertical: 5, borderRadius: 18,
      backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    chipTextOn: { color: '#fff', fontWeight: '700' },
    // 필터 버튼 — 소개팅과 동일하게 chip 모양 위에 인라인 배치
    filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 16, marginLeft: 4 },
    filterBadge: { minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    filterBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
    // 정렬 + 뷰토글 줄 — 소개팅 resultRow 와 동일
    resultRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, paddingVertical: 6 },
    sortRow: { gap: 6, alignItems: 'center', paddingRight: 12 },
    sortChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
    sortChipActive: { backgroundColor: '#FF6B9D18', borderColor: colors.primary },
    sortChipText: { fontSize: 12, color: colors.textTertiary, fontWeight: '500' },
    sortChipTextActive: { color: colors.primary, fontWeight: '700' },
    excludeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 2 },
    excludeChipActive: { backgroundColor: '#FF6B9D18', borderColor: colors.primary, paddingLeft: 10 },
    checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
    viewToggle: { flexDirection: 'row', gap: 2, marginLeft: 6, marginRight: 4 },
    viewBtn: { width: 30, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    activeFilterRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingVertical: 6, gap: 8 },
    activeChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '22', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.primary + '44' },
    activeChipText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    resetBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    resetText: { fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    searchInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.divider },
    searchInfoText: { flex: 1, fontSize: 13, color: colors.textSecondary },
    searchClear: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    footer: { paddingVertical: 16 },
  })
}
