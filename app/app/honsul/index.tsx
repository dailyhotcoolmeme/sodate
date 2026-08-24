import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import PlaceListItem from '@/components/PlaceListItem'
import EventSearchModal from '@/components/EventSearchModal'
import AppSpinner from '@/components/AppSpinner'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlaces, placeMarkerUrl, openStatus, type PlaceRow } from '@/lib/places'
import { REGION_GROUP_ORDER, regionGroupKey } from '@/constants/chipGroups'
import { sanggwonFor } from '@/constants/honsulSanggwon'
import { getMyLocation, distanceKm } from '@/lib/nearby'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { addRecentSearch } from '@/lib/eventSearchHistory'
import PlaceMap, { NAVER_MAP_AVAILABLE } from '@/components/PlaceMap'
import PlaceMapCard from '@/components/PlaceMapCard'
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
  const [regionGroup, setRegionGroup] = useState<string | null>(null)   // 지역군(강남권…) — 소개팅·소셜링과 동일
  const [sanggwon, setSanggwon] = useState<string | null>(null)         // 상권(홍대·서면…) — 지역군 아래 세부
  const [openNow, setOpenNow] = useState(false)                    // 영업중만
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(null) // 내 주변(거리정렬)
  const [locBusy, setLocBusy] = useState(false)
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

  // 매장별 상권·지역군 1회 계산. 지역군은 주소(도로명) 기준 — region(동)은 분류가 안 된다.
  const sangOf = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const p of all) m.set(p.id, sanggwonFor(p.lat, p.lng))
    return m
  }, [all])
  const groupOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of all) m.set(p.id, regionGroupKey(p.address_road ?? p.region ?? ''))
    return m
  }, [all])
  // 지역군 칩 — 소개팅·소셜링과 같은 순서(강남권·강북권·강서권·경기…), 매장 있는 것만.
  const regionGroups = useMemo(() => {
    const has = new Set([...all].map((p) => groupOf.get(p.id)))
    return REGION_GROUP_ORDER.map((g) => g.key).filter((k) => has.has(k))
  }, [all, groupOf])
  // 상권 목록 = 매장 있는 상권만, 매장수 많은 순. 지역군 선택 시 그 안의 상권만.
  const sanggwons = useMemo(() => {
    const c = new Map<string, number>()
    for (const p of all) {
      if (regionGroup && groupOf.get(p.id) !== regionGroup) continue
      const s = sangOf.get(p.id); if (s) c.set(s, (c.get(s) ?? 0) + 1)
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
  }, [all, sangOf, groupOf, regionGroup])

  const list = useMemo(() => {
    const q = search.trim()
    const filtered = all.filter((p) =>
      (!regionGroup || groupOf.get(p.id) === regionGroup) &&
      (!sanggwon || sangOf.get(p.id) === sanggwon) &&
      (!openNow || openStatus(p.hours).open === true) &&
      (!tag || [...p.honsul_badges, ...p.mood_tags].includes(tag)) &&
      (!q || p.name.includes(q) || (p.region ?? '').includes(q)),
    )
    // 내 주변이면 거리순, 아니면 원래 순서.
    if (myLoc) {
      return filtered
        .map((p) => ({ p, d: p.lat != null && p.lng != null ? distanceKm(myLoc.lat, myLoc.lng, p.lat, p.lng) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.p)
    }
    return filtered
  }, [all, regionGroup, sanggwon, openNow, tag, search, myLoc, sangOf, groupOf])

  // 스크롤하면 지역군 칩 줄이 접힌다 — 소개팅·소셜링과 동일 기준.
  const chipsAnim = useRef(new Animated.Value(1)).current
  const chipsExpandedRef = useRef(true)
  const onFeedScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    const was = chipsExpandedRef.current
    const expand = was ? y <= 60 : y <= 8
    if (expand !== was) {
      chipsExpandedRef.current = expand
      Animated.timing(chipsAnim, { toValue: expand ? 1 : 0, duration: 200, useNativeDriver: false }).start()
    }
  }, [chipsAnim])

  const openOnMap = (p: PlaceRow) => { setFocused(p); setTab('map') }

  // 적용된 필터칩 — 소개팅·소셜링과 완전히 동일한 규격(activeChip + 초기화).
  const activeChips: { label: string; onRemove: () => void }[] = []
  if (regionGroup) activeChips.push({ label: regionGroup, onRemove: () => { setRegionGroup(null); setSanggwon(null) } })
  if (sanggwon) activeChips.push({ label: sanggwon, onRemove: () => setSanggwon(null) })
  if (tag) activeChips.push({ label: tag, onRemove: () => setTag(null) })
  if (openNow) activeChips.push({ label: '영업중', onRemove: () => setOpenNow(false) })
  if (search) activeChips.push({ label: `‘${search}’`, onRemove: () => setSearch('') })
  const resetAll = () => { setRegionGroup(null); setSanggwon(null); setTag(null); setOpenNow(false); setSearch('') }

  // 내 주변 — 위치 얻어 거리순 정렬. 다시 누르면 해제.
  const toggleNearby = useCallback(async () => {
    if (myLoc) { setMyLoc(null); return }
    setLocBusy(true)
    const loc = await getMyLocation()
    setLocBusy(false)
    if (loc) setMyLoc(loc)
  }, [myLoc])

  return (
    <View style={styles.container}>
      <TopBar onSearchPress={() => setSearchVisible(true)} />

      {tab === 'feed' ? (
        <View style={{ flex: 1 }}>
          {/* 지역군 칩 + 상권 칩 2줄 — 소개팅처럼 스크롤하면 통째로 접힌다(영업중 줄만 남는다). */}
          <Animated.View style={{ height: chipsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 72] }), opacity: chipsAnim, overflow: 'hidden' }}>
          <View style={styles.regionScroll}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flex: 1 }}>
              {regionGroups.map((g) => (
                <Chip key={g} label={g} active={regionGroup === g}
                  onPress={() => { const next = regionGroup === g ? null : g; setRegionGroup(next); setSanggwon(null) }} colors={colors} />
              ))}
            </ScrollView>
          </View>

          <View style={styles.regionScroll}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={{ flex: 1 }}>
              {sanggwons.map((s) => <Chip key={s} label={s} active={sanggwon === s} onPress={() => setSanggwon(sanggwon === s ? null : s)} colors={colors} />)}
            </ScrollView>
          </View>
          </Animated.View>

          {/* ── 활성 필터 칩 + 초기화 — 소개팅·소셜링과 동일(정렬줄 위, 같은 규격) ── */}
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
              <TouchableOpacity onPress={resetAll} style={styles.resetBtn}>
                <Text style={styles.resetText}>초기화</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 영업중 — 소개팅 '마감제외'와 같은 체크박스 방식 */}
          <View style={styles.resultRow}>
            <TouchableOpacity style={[styles.sortChip, styles.excludeChip, openNow && styles.excludeChipActive]} onPress={() => setOpenNow((v) => !v)}>
              <View style={[styles.checkbox, openNow && styles.checkboxOn]}>
                {openNow && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}
              </View>
              <Text style={[styles.sortChipText, openNow && styles.sortChipTextActive]}>영업중</Text>
            </TouchableOpacity>
            {myLoc && <Text style={styles.countText}>가까운순</Text>}
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
              onScroll={onFeedScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 96 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* 보기 전환 FAB — 예전엔 상단 고정 탭이었다(2026-08-24 오너 지시로 하단 플로팅으로
              이동, 혼술맵 실제 앱 방식: 확대/내위치/목록 3버튼을 우하단에 쌓는 것 참고).
              지도 탭엔 네이티브 지도 SDK 자체 '내 위치' 버튼이 있어(showLocationButton)
              여기 내 주변 버튼은 피드 쪽에만 둔다. */}
          <View style={[styles.fabStack, { bottom: insets.bottom + 14 }]}>
            <TouchableOpacity
              style={[styles.fabSmall, myLoc && styles.fabSmallOn]}
              onPress={toggleNearby} activeOpacity={0.8} disabled={locBusy}
            >
              <Ionicons name={myLoc ? 'navigate' : 'navigate-outline'} size={18} color={myLoc ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fabPrimary} onPress={() => setTab('map')} activeOpacity={0.85}>
              <Ionicons name="map-outline" size={22} color={colors.background} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* 지도 탭 — 네이버 지도(재빌드 후). 네이티브 모듈 없으면 안내로 폴백. */
        <View style={{ flex: 1 }}>
          {(() => {
            const pinned = list.filter((p) => p.lat != null && p.lng != null)
            const center = focused && focused.lat != null ? focused : pinned[0]
            if (NAVER_MAP_AVAILABLE && center?.lat != null && center?.lng != null) {
              return (
                <>
                  <PlaceMap
                    style={{ flex: 1 }}
                    focus={{ lat: center.lat, lng: center.lng }}
                    zoom={focused ? 16 : 12}
                    showLocationButton
                    cluster
                    onTapPin={(id) => setFocused(pinned.find((p) => p.id === id) ?? null)}
                    pins={pinned.map((p) => ({
                      id: p.id,
                      lat: p.lat!,
                      lng: p.lng!,
                      name: p.name,
                      markerUrl: placeMarkerUrl(p),
                      active: focused?.id === p.id,
                    }))}
                  />
                  {focused && (
                    <PlaceMapCard
                      place={focused}
                      isFavorite={favoriteIds.has(focused.id)}
                      onToggleFavorite={() => toggleFav(focused.id)}
                      onOpen={() => router.push(`/place/${focused.id}`)}
                      onClose={() => setFocused(null)}
                    />
                  )}
                </>
              )
            }
            return (
              <View style={styles.center}>
                <Ionicons name="map-outline" size={40} color={colors.textTertiary} />
                <Text style={styles.emptyText}>지도는 준비 중이에요</Text>
                <Text style={styles.emptySub}>네이버 지도 연동(재빌드) 후 여기에서 위치를 봐요{focused ? `\n(선택: ${focused.name})` : ''}</Text>
              </View>
            )
          })()}

          {/* 피드로 돌아가기 — 지도엔 네이티브 SDK 자체 내 위치 버튼이 있어(showLocationButton) 이거 하나만.
              마커 선택 시 뜨는 PlaceMapCard(바닥 카드, 사진 92 높이)와 겹치지 않게 그만큼 올린다. */}
          <View style={[styles.fabStack, { bottom: insets.bottom + (focused ? 140 : 14) }]}>
            <TouchableOpacity style={styles.fabPrimary} onPress={() => setTab('feed')} activeOpacity={0.85}>
              <Ionicons name="list-outline" size={22} color={colors.background} />
            </TouchableOpacity>
          </View>
        </View>
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

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    regionScroll: { height: 34, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
    chipRow: { paddingHorizontal: 16, alignItems: 'center', gap: 6 },
    // 보기 전환 FAB — 우하단 세로 스택(2026-08-24 오너 지시, 혼술맵 실제 앱 방식 참고).
    // 콘텐츠 위에 뜨는 플로팅이라 board 글쓰기 FAB과 같은 그림자를 준다(하단 고정바와는 다름).
    fabStack: { position: 'absolute', right: 16, alignItems: 'center', gap: 10 },
    fabSmall: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
    },
    fabSmallOn: { borderColor: colors.primary },
    fabPrimary: {
      width: 52, height: 52, borderRadius: 26, backgroundColor: colors.textPrimary,
      alignItems: 'center', justifyContent: 'center',
      shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
    },
    // 활성 필터칩 — 소개팅·소셜링과 완전히 동일한 값
    activeFilterRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingVertical: 6, gap: 8 },
    activeChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary + '22', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.primary + '44' },
    activeChipText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    resetBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    resetText: { fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    // 영업중 — 소개팅 '마감제외'와 동일 규격
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4, paddingVertical: 6 },
    sortChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
    sortChipText: { fontSize: 12, color: colors.textTertiary, fontWeight: '500' },
    sortChipTextActive: { color: colors.primary, fontWeight: '700' },
    excludeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 2 },
    excludeChipActive: { backgroundColor: '#FF6B9D18', borderColor: colors.primary, paddingLeft: 10 },
    checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
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
