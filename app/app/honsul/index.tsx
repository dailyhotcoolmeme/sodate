import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import PlaceListItem from '@/components/PlaceListItem'
import EventSearchModal from '@/components/EventSearchModal'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlaces, type PlaceRow } from '@/lib/places'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { addRecentSearch } from '@/lib/eventSearchHistory'
import PlaceMap, { NAVER_MAP_AVAILABLE } from '@/components/PlaceMap'
import { useRouter } from 'expo-router'

/**
 * 혼술바 탭 — 상시 매장(places). 피드/지도 두 탭. 종류는 (현재 2종뿐이라) 헤더칩에서 뺌 →
 * 필요하면 상세 필터로. 지도는 카카오맵(앱키+재빌드) 연동 후 채운다. 카드 지도아이콘 → 지도탭.
 * ⚠️ NEW_TABS_ENABLED=false 동안은 접근 경로 없음. (파일럿) 전부 불러와 클라 필터.
 */
type Tab = 'feed' | 'map'

export default function HonsulScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [all, setAll] = useState<PlaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<Tab>('feed')
  const [region, setRegion] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [focused, setFocused] = useState<PlaceRow | null>(null)   // 지도탭에서 볼 업체
  const { favoriteIds, toggle: toggleFav } = usePlaceFavorites()
  const router = useRouter()

  const load = useCallback(async () => {
    try { setAll(await fetchPlaces()) } catch (e) { /* 조용히 */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  const regions = useMemo(() => Array.from(new Set(all.map((p) => p.region).filter(Boolean))) as string[], [all])
  const list = useMemo(() => {
    const q = search.trim()
    return all.filter((p) =>
      (!region || p.region === region) &&
      (!tag || [...p.honsul_badges, ...p.mood_tags].includes(tag)) &&
      (!q || p.name.includes(q) || (p.region ?? '').includes(q))
    )
  }, [all, region, tag, search])

  const openOnMap = (p: PlaceRow) => { setFocused(p); setTab('map') }

  return (
    <View style={styles.container}>
      <TopBar onSearchPress={() => setSearchVisible(true)} />

      {/* 피드 / 지도 탭 */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'feed' && styles.tabOn]} onPress={() => setTab('feed')} activeOpacity={0.8}>
          <Text style={[styles.tabText, tab === 'feed' && styles.tabTextOn]}>피드</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'map' && styles.tabOn]} onPress={() => setTab('map')} activeOpacity={0.8}>
          <Text style={[styles.tabText, tab === 'map' && styles.tabTextOn]}>지도</Text>
        </TouchableOpacity>
      </View>

      {tab === 'feed' ? (
        <>
          {/* 지역 칩 */}
          <View style={styles.regionScroll}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flex: 1 }}>
              <Chip label="전체" active={region === null} onPress={() => setRegion(null)} colors={colors} />
              {regions.map((r) => <Chip key={r} label={r} active={region === r} onPress={() => setRegion(region === r ? null : r)} colors={colors} />)}
            </ScrollView>
          </View>

          <View style={styles.countRow}>
            <Text style={styles.countText}>{list.length}곳</Text>
            {tag && <FilterChip label={`#${tag}`} onClear={() => setTag(null)} styles={styles} colors={colors} />}
            {!!search && <FilterChip label={`‘${search}’`} onClear={() => setSearch('')} styles={styles} colors={colors} />}
          </View>

          {loading ? (
            <View style={styles.center}><AppSpinner /></View>
          ) : list.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="wine-outline" size={34} color={colors.textTertiary} />
              <Text style={styles.emptyText}>조건에 맞는 혼술바가 없어요</Text>
              <Text style={styles.emptySub}>필터를 바꿔보세요</Text>
            </View>
          ) : (
            <FlatList
              data={list}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <PlaceListItem place={item} onTagPress={setTag} onMapPress={openOnMap}
                  isFavorite={favoriteIds.has(item.id)} onToggleFavorite={() => toggleFav(item.id)} />
              )}
              contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 16 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      ) : (
        /* 지도 탭 — 네이버 지도(재빌드 후). 네이티브 모듈 없으면 안내로 폴백. */
        (() => {
          const pinned = list.filter((p) => p.lat != null && p.lng != null)
          const center = focused && focused.lat != null ? focused : pinned[0]
          if (NAVER_MAP_AVAILABLE && center?.lat != null && center?.lng != null) {
            return (
              <PlaceMap
                style={{ flex: 1 }}
                focus={{ lat: center.lat, lng: center.lng }}
                zoom={focused ? 15 : 12}
                pins={pinned.map((p) => ({
                  id: p.id,
                  lat: p.lat!,
                  lng: p.lng!,
                  name: p.name,
                  active: focused?.id === p.id,
                  onPress: () => router.push(`/place/${p.id}`),
                }))}
              />
            )
          }
          return (
            <View style={styles.center}>
              <Ionicons name="map-outline" size={40} color={colors.textTertiary} />
              <Text style={styles.emptyText}>지도는 준비 중이에요</Text>
              <Text style={styles.emptySub}>네이버 지도 연동(재빌드) 후 여기에서 위치를 봐요{focused ? `\n(선택: ${focused.name})` : ''}</Text>
            </View>
          )
        })()
      )}

      <BottomNav current="honsul" />
      <EventSearchModal visible={searchVisible} onClose={() => setSearchVisible(false)} onSearch={(t) => { setSearch(t); addRecentSearch(t) }} colors={colors} />
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
function FilterChip({ label, onClear, styles, colors }: { label: string; onClear: () => void; styles: any; colors: AppColors }) {
  return (
    <TouchableOpacity style={styles.tagFilterChip} onPress={onClear} activeOpacity={0.7}>
      <Text style={styles.tagFilterText}>{label}</Text>
      <Ionicons name="close" size={12} color={colors.primary} />
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 6, gap: 18, borderBottomWidth: 1, borderBottomColor: colors.divider },
    tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.primary },
    tabText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    tabTextOn: { color: colors.textPrimary, fontWeight: '800' },
    regionScroll: { height: 34, marginTop: 6, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
    chipRow: { paddingHorizontal: 16, alignItems: 'center', gap: 6 },
    chip: { paddingHorizontal: 13, paddingVertical: 5, borderRadius: 18, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    chipTextOn: { color: '#fff', fontWeight: '700' },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
    countText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    tagFilterChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${colors.primary}1a`, borderRadius: 12, paddingLeft: 9, paddingRight: 6, paddingVertical: 3 },
    tagFilterText: { fontSize: 12, color: colors.primary, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60, paddingHorizontal: 30 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  })
}
