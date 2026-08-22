import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import SocialingListItem from '@/components/SocialingListItem'
import SocialingCard from '@/components/SocialingCard'
import EventSearchModal from '@/components/EventSearchModal'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useEvents } from '@/hooks/useEvents'
import { useFavorites } from '@/hooks/useFavorites'
import { SOCIALING_GROUPS } from '@/constants/socialingCategories'
import { addRecentSearch } from '@/lib/eventSearchHistory'

/**
 * 소셜링 목록 화면(2026-08-21, 오너 승인). 소개팅 피드와 같은 구성 — 검색·카테고리 필터·뷰토글.
 * 카드는 목록형(SocialingListItem)/카드형(SocialingCard) 토글. 데이터는 event_type='socialing'.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
export default function SocialingScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [group, setGroup] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const { events, loading, loadingMore, refetch, loadMore } = useEvents(search, 'socialing', group)
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const runSearch = (term: string) => { setSearch(term); addRecentSearch(term) }
  const clearSearch = () => setSearch('')

  const isEmpty = !loading && events.length === 0

  return (
    <View style={styles.container}>
      <TopBar onSearchPress={() => setSearchVisible(true)} />

      {/* 카테고리 칩 필터 + 뷰토글 */}
      <View style={styles.catBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar} style={{ flex: 1 }}>
          <Chip label="전체" active={group === undefined} onPress={() => setGroup(undefined)} colors={colors} />
          {SOCIALING_GROUPS.map((g) => (
            <Chip key={g.key} label={g.label} active={group === g.key}
              onPress={() => setGroup(group === g.key ? undefined : g.key)} colors={colors} />
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

      {/* 검색 활성 안내 */}
      {!!search && (
        <View style={styles.searchInfo}>
          <Text style={styles.searchInfoText} numberOfLines={1}>‘{search}’ 검색 결과 {events.length}건</Text>
          <TouchableOpacity onPress={clearSearch} hitSlop={8}><Text style={styles.searchClear}>지우기</Text></TouchableOpacity>
        </View>
      )}

      {loading && events.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={34} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{search ? '검색 결과가 없어요' : '해당 카테고리 모임이 아직 없어요'}</Text>
          <Text style={styles.emptySub}>{search ? '다른 검색어를 입력해보세요' : '다른 카테고리를 골라보세요'}</Text>
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
    catBarWrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, paddingRight: 10 },
    catBar: { paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginRight: 7,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    chipTextOn: { color: '#fff' },
    viewToggle: { flexDirection: 'row', gap: 2, flexShrink: 0 },
    viewBtn: { padding: 6, borderRadius: 8 },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    searchInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.divider },
    searchInfoText: { flex: 1, fontSize: 13, color: colors.textSecondary },
    searchClear: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    footer: { paddingVertical: 16 },
  })
}
