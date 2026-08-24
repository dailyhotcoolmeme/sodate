import React, { useState, useMemo, useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFavoriteEvents, useFavorites } from '@/hooks/useFavorites'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { fetchPlaces, type PlaceRow } from '@/lib/places'
import EventCard from '@/components/EventCard'
import EventListItem from '@/components/EventListItem'
import PlaceListItem from '@/components/PlaceListItem'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import type { EventWithCompany } from '@/lib/supabase'
import { track } from '@/lib/analytics'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

type ViewMode = 'card' | 'list'
type Tab = 'dating' | 'socialing' | 'place'

const TABS: { key: Tab; label: string }[] = [
  { key: 'dating', label: '소개팅' },
  { key: 'socialing', label: '소셜링' },
  { key: 'place', label: '혼술바' },
]

/** 즐겨찾기 — MY "즐겨찾기" 진입. 소개팅·소셜링·혼술바를 탭으로 나눈다(2026-08-24 개편). */
export default function FavoritesScreen() {
  const insets = useSafeAreaInsets()
  const { type } = useLocalSearchParams<{ type?: string }>()
  const [tab, setTab] = useState<Tab>(type === 'socialing' ? 'socialing' : type === 'place' ? 'place' : 'dating')

  const { events: allEvents, loading: eventsLoading, error, refetch } = useFavoriteEvents()
  const datingEvents = useMemo(() => allEvents.filter((e: any) => e.event_type !== 'socialing'), [allEvents])
  const socialingEvents = useMemo(() => allEvents.filter((e: any) => e.event_type === 'socialing'), [allEvents])
  const { favoriteIds, toggle } = useFavorites()

  // 혼술바 — 장소는 목록 전체를 받아 관심 id로 거른다(장소 훅과 동일 패턴, favorites/places.tsx 였던 것).
  const { favoriteIds: placeFavoriteIds, toggle: togglePlace } = usePlaceFavorites()
  const [allPlaces, setAllPlaces] = useState<PlaceRow[]>([])
  const [placesLoading, setPlacesLoading] = useState(true)
  useEffect(() => {
    let alive = true
    fetchPlaces().then((p) => { if (alive) { setAllPlaces(p); setPlacesLoading(false) } }).catch(() => setPlacesLoading(false))
    return () => { alive = false }
  }, [])
  const places = useMemo(() => allPlaces.filter((p) => placeFavoriteIds.has(p.id)), [allPlaces, placeFavoriteIds])

  const events = tab === 'socialing' ? socialingEvents : datingEvents
  const loading = tab === 'place' ? placesLoading : eventsLoading
  const kind = tab === 'socialing' ? '소셜링' : tab === 'place' ? '혼술바' : '소개팅'
  const count = tab === 'place' ? places.length : events.length
  // 조사: 소개팅·소셜링은 받침 있음(을/이), 혼술바는 받침 없음(를/가) — 탭이 고정 3개라 하드코딩.
  const eul = tab === 'place' ? '를' : '을'
  const i = tab === 'place' ? '가' : '이'

  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const { refreshing, onRefresh } = useRefreshIndicator(eventsLoading, refetch)

  React.useEffect(() => { track('screen_view', { properties: { screen: 'favorites' } }) }, [])
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.container}>
      <TopBar showBack title="즐겨찾기" />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabOn]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.header}>
        {tab !== 'place' && (
          <View style={styles.headerRow}>
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
        )}
        <Text style={styles.subtitle}>
          {loading ? '' : `${count}개의 ${kind}${eul} 저장했습니다`}
        </Text>
      </View>

      {loading && count === 0 ? (
        <View style={styles.center}>
          <AppSpinner />
        </View>
      ) : tab !== 'place' && error ? (
        // 예전엔 실패해도 빈 목록으로 보여서 저장한 찜이 사라진 것처럼 느껴졌다.
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>관심 목록을 불러오지 못했어요</Text>
          <Text style={styles.emptySubText}>저장한 목록은 그대로 있습니다</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn} activeOpacity={0.85}>
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : count === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bookmark" size={48} color={colors.primary} />
          <Text style={styles.emptyText}>아직 관심 {kind}{i} 없습니다</Text>
          <Text style={styles.emptySubText}>
            {tab === 'place' ? '매장의 북마크를 눌러 저장하세요' : '이벤트 카드의 하트를 눌러 저장하세요'}
          </Text>
        </View>
      ) : tab === 'place' ? (
        <FlatList
          data={places}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <PlaceListItem place={item} isFavorite onToggleFavorite={() => togglePlace(item.id)} />
          )}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        />
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

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // 탭 — 알림 설정·혼술바(피드/지도)와 동일한 밑줄 탭 규격.
    tabs: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 18,
      paddingHorizontal: 16, paddingTop: 8,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.primary },
    tabText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    tabTextOn: { color: colors.textPrimary, fontWeight: '800' },
    header: { paddingHorizontal: 16, paddingBottom: 12 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingTop: 8,
      marginBottom: 8,
    },
    toggleRow: { flexDirection: 'row', gap: 2 },
    viewBtn: {
      width: 30,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
    },
    viewBtnActive: { backgroundColor: colors.surfaceHigh },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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
  })
}
