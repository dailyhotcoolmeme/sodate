import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import SocialingListItem from '@/components/SocialingListItem'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useEvents } from '@/hooks/useEvents'
import { useFavorites } from '@/hooks/useFavorites'
import { SOCIALING_GROUPS } from '@/constants/socialingCategories'

/**
 * 소셜링 목록 화면(2026-08-21, 오너 승인). 소개팅 피드와 같은 리스트 틀 + 카테고리 칩 필터.
 * 카드는 SocialingListItem(카테고리 배지 + 참여현황). 데이터는 event_type='socialing'.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 *    소셜링 데이터는 event_type='socialing' 이라 소개팅 피드(dating)에는 섞이지 않는다.
 */
export default function SocialingScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  // 선택된 통합 카테고리 그룹 key. undefined = 전체.
  const [group, setGroup] = useState<string | undefined>(undefined)
  const { events, loading, loadingMore, error, refetch, loadMore } = useEvents('', 'socialing', group)
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refetch()
    setRefreshing(false)
  }, [refetch])

  const isEmpty = !loading && events.length === 0

  return (
    <View style={styles.container}>
      <TopBar />

      {/* 카테고리 칩 필터 — 통합 10종 + 전체 */}
      <View style={styles.catBarWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar}>
          <Chip label="전체" active={group === undefined} onPress={() => setGroup(undefined)} colors={colors} />
          {SOCIALING_GROUPS.map((g) => (
            <Chip
              key={g.key}
              label={`${g.emoji} ${g.label}`}
              active={group === g.key}
              onPress={() => setGroup(group === g.key ? undefined : g.key)}
              colors={colors}
            />
          ))}
        </ScrollView>
      </View>

      {loading && events.length === 0 ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={34} color={colors.textTertiary} />
          <Text style={styles.emptyText}>해당 카테고리 모임이 아직 없어요</Text>
          <Text style={styles.emptySub}>다른 카테고리를 골라보세요</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <SocialingListItem
              event={item}
              isFavorite={favoriteIds.has(item.id)}
              onToggleFavorite={() => toggleFavorite(item.id)}
            />
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
    catBarWrap: { borderBottomWidth: 1, borderBottomColor: colors.divider },
    catBar: { paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginRight: 7,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    chipTextOn: { color: '#fff' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    footer: { paddingVertical: 16 },
  })
}
