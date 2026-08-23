import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFavoriteEvents, useFavorites } from '@/hooks/useFavorites'
import EventCard from '@/components/EventCard'
import EventListItem from '@/components/EventListItem'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import { track } from '@/lib/analytics'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

type ViewMode = 'card' | 'list'

export default function FavoritesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { type } = useLocalSearchParams<{ type?: string }>()
  const isSocialing = type === 'socialing'
  const { events: allEvents, loading, error, refetch } = useFavoriteEvents()
  // 소개팅/소셜링을 event_type으로 나눠 각각 별도 화면으로 보여준다(MY에서 분리 진입).
  const events = useMemo(
    () => allEvents.filter((e: any) => (e.event_type === 'socialing') === isSocialing),
    [allEvents, isSocialing],
  )
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  const { favoriteIds, toggle } = useFavorites()
  const kind = isSocialing ? '소셜링' : '소개팅'

  React.useEffect(() => { track('screen_view', { properties: { screen: 'favorites' } }) }, [])
  const [viewMode, setViewMode] = useState<ViewMode>('list') // 관심 소개팅 기본=리스트형
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingBottom: 12 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 8,
      marginBottom: 8,
    },
    backBtn: { paddingVertical: 4, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    toggleRow: { flexDirection: 'row', gap: 2 },
    viewBtn: {
      width: 30,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    viewBtnText: { fontSize: 16, color: colors.textTertiary },
    viewBtnTextActive: { color: colors.textPrimary },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyIcon: { fontSize: 48, color: colors.primary },
    emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
    emptySubText: { fontSize: 13, color: colors.textTertiary },
    retryBtn: {
      marginTop: 4,
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    retryText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  }), [colors])

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>관심 {kind}</Text>
          <View style={styles.toggleRow}>
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
        <Text style={styles.subtitle}>
          {loading ? '' : `${events.length}개의 ${kind}을 저장했습니다`}
        </Text>
      </View>

      {loading && events.length === 0 ? (
        <View style={styles.center}>
          <AppSpinner />
        </View>
      ) : error ? (
        // 예전엔 실패해도 빈 목록으로 보여서 저장한 찜이 사라진 것처럼 느껴졌다.
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>관심 목록을 불러오지 못했어요</Text>
          <Text style={styles.emptySubText}>저장한 목록은 그대로 있습니다</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn} activeOpacity={0.85}>
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="heart-outline" size={48} color={colors.primary} />
          <Text style={styles.emptyText}>아직 관심 {kind}이 없습니다</Text>
          <Text style={styles.emptySubText}>이벤트 카드의 하트를 눌러 저장하세요</Text>
        </View>
      ) : (
        <FlatList
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          data={events as EventWithCompany[]}
          renderItem={({ item }) =>
            viewMode === 'card' ? (
              <EventCard
                event={item}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggle(item.id)}
              />
            ) : (
              <EventListItem
                event={item}
                isFavorite={favoriteIds.has(item.id)}
                onToggleFavorite={() => toggle(item.id)}
              />
            )
          }
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}
