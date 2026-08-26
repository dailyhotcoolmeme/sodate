import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { View, Text, StyleSheet, FlatList, ScrollView, TouchableOpacity, RefreshControl, Animated, Image } from 'react-native'
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
import { getCachedLocation, setCachedLocation } from '@/lib/locationMemory'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { useHonsulFilterStore, useHonsulFilterHydrated } from '@/stores/honsulFilterStore'
import { addRecentSearch } from '@/lib/eventSearchHistory'
import { saveScrollOffset } from '@/lib/scrollMemory'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { confirmFavorite } from '@/lib/confirmToggle'
import PlaceMap, { NAVER_MAP_AVAILABLE } from '@/components/PlaceMap'
import PlaceMapCard from '@/components/PlaceMapCard'
import { useRouter } from 'expo-router'

/**
 * 혼술바 탭 — 상시 매장(places). 피드/지도 두 탭. 종류는 (현재 2종뿐이라) 헤더칩에서 뺌 →
 * 필요하면 상세 필터로. 지도는 카카오맵(앱키+재빌드) 연동 후 채운다. 카드 지도아이콘 → 지도탭.
 * ⚠️ NEW_TABS_ENABLED=false 동안은 접근 경로 없음. (파일럿) 전부 불러와 클라 필터.
 */
export default function HonsulScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [all, setAll] = useState<PlaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // 지역군·상권·영업중·정렬·피드/지도 탭 — 예전엔 전부 로컬 useState라 화면을 나갔다
  // 돌아오면 다 풀렸다(오너 지적: "지도보기 상태에서 다른 메뉴 갔다가 돌아오면 피드보기로
  // 바껴있다"). 소개팅·소셜링처럼 persist 스토어로 옮겼다(2026-08-24/25). myLoc(좌표)·
  // locBusy 는 세션마다 새로 재는 게 맞아서 로컬로 남긴다.
  const hydrated = useHonsulFilterHydrated()
  const {
    regionGroup, sanggwon, openNow, sortMode, hasAutoInit, tab, mapView,
    setRegionGroup, setSanggwon, setOpenNow, setSortMode, setHasAutoInit, setTab, setMapView,
  } = useHonsulFilterStore()
  // 현재 위치(거리정렬용) — 예전엔 화면 로컬 useState라 다른 탭 갔다 돌아오면(화면이 통째로
  // 다시 마운트되며) 매번 null 로 리셋됐다. "거리순" 칩은 스토어에 남아 계속 켜져 보이는데
  // 실제 좌표가 없어 정렬은 조용히 풀려 있었다(2026-08-25 오너 지적: "현재위치를 계속
  // 물고 있을순 없나?"). lib/locationMemory.ts(세션 동안 유지)에서 초기값을 가져온다.
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number } | null>(() => getCachedLocation())
  const [locBusy, setLocBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [focused, setFocused] = useState<PlaceRow | null>(null)   // 지도탭에서 볼 업체
  // 지도 카메라 — cameraTarget(지도에 실제로 "여기로 가라"고 명령하는 값, PlaceMap 의 focus
  // prop 으로 들어감)과 mapView(그냥 기억만 해두는 값, 스토어에 저장)를 분리했다. 처음엔
  // 하나로 같이 썼다가 onCameraIdle→setMapView→focus prop 변경→다시 이동 명령→다시 idle…
  // 무한루프에 빠져 "확대한 위치 안에서 혼자 왔다갔다 움직인다"는 버그가 났다(오너 지적,
  // 2026-08-25). cameraTarget 은 마커를 명시적으로 눌렀을 때만 바뀐다 — 자유 팬/줌은
  // mapView(기억용)만 갱신하고 cameraTarget/focus prop 은 절대 안 건드려서 루프를 막는다.
  // 최초 진입 값은 하이드레이션 끝난 뒤 저장된 mapView 에서 딱 한 번만 읽어온다.
  const [cameraTarget, setCameraTarget] = useState<{ lat: number; lng: number; zoom: number } | null>(null)
  const cameraInitedRef = useRef(false)
  useEffect(() => {
    if (!hydrated || cameraInitedRef.current) return
    cameraInitedRef.current = true
    if (mapView) setCameraTarget(mapView)
  }, [hydrated, mapView])
  // 위치를 새로 구하면 좌표 상태만이 아니라 지도 카메라도 같이 옮긴다(2026-08-25 오너
  // 지시: "현재위치 누를때 지도에도 그게 자동 적용되게 해서 지도로 진입하면 자동으로
  // 현재위치에 지도가 나오게"). 위치를 구하는 것 자체가 명시적 이동 의도라 cameraTarget
  // (카메라 진동 버그 방지를 위해 명시적 의도로만 바뀌는 값)을 건드려도 안전하다.
  const applyLocation = useCallback((loc: { lat: number; lng: number }) => {
    setMyLoc(loc)
    setCachedLocation(loc)
    setCameraTarget({ lat: loc.lat, lng: loc.lng, zoom: 15 })
    setMapView({ lat: loc.lat, lng: loc.lng, zoom: 15 })
  }, [setMapView])
  const { favoriteIds, toggle: toggleFav } = usePlaceFavorites()
  const router = useRouter()

  const load = useCallback(async () => {
    try { setAll(await fetchPlaces()) } catch (e) { /* 조용히 */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  // ⚠️(2026-08-26) 지도 마커 사진(placeMarkerUrl — R2에 미리 만들어둔 원형 크롭 PNG,
  // profile_image와 다른 별도 URL)은 지도 탭에 마커를 그릴 때가 돼서야 네트워크로 받아온다.
  // "지도보기"로 처음 들어가면 그 순간 여러 마커가 동시에 이미지를 받아오는 동안, 마커
  // 라이브러리(NaverMapMarkerOverlay)의 image prop 기본값이 {symbol:'green'}이라 아직 못
  // 받은 마커는 그 초록 핀이 대신 보인다(오너 제보: "녹색 화살표로 나오는게 있는데...
  // 업체 이미지(동그라미) 이걸로 나와야하는데" — 확대·축소하면 그새 다 받아져서 정상으로
  // 보인다고 재확인함). 지도 탭에 들어가기 전, 피드 목록을 받아온 시점에 미리 이미지를
  // 캐시에 받아두면(RN Image.prefetch — 안드로이드에선 이 마커 라이브러리도 같은 Fresco
  // 이미지 파이프라인을 쓰므로 캐시가 공유돼 효과가 있다) 실제로 지도를 열 때는 이미
  // 캐시에 있어 초록 핀이 거의 안 보이게 된다.
  useEffect(() => {
    if (all.length === 0) return
    for (const p of all) {
      const url = placeMarkerUrl(p)
      if (url) Image.prefetch(url).catch(() => {})
    }
  }, [all])

  // 최초 진입 자동 위치요청(2026-08-24 오너 지시) — 이 화면에 평생 딱 한 번(hasAutoInit),
  // 들어오자마자 위치 권한을 물어서 허용하면 거리순, 거부하면 리뷰많은순으로 기본 정렬을
  // 잡는다. hydrated 되기 전엔 hasAutoInit 이 기본값(false)이라 오판할 수 있어 기다린다.
  useEffect(() => {
    if (!hydrated || hasAutoInit) return
    setHasAutoInit(true)
    ;(async () => {
      setLocBusy(true)
      const loc = await getMyLocation()
      setLocBusy(false)
      if (loc) { applyLocation(loc); setSortMode('distance') }
      else setSortMode('reviewCount')
    })()
  }, [hydrated, hasAutoInit, setHasAutoInit, setSortMode, applyLocation])

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
      (!q || p.name.includes(q) || (p.region ?? '').includes(q)),
    )
    if (sortMode === 'distance' && myLoc) {
      return filtered
        .map((p) => ({ p, d: p.lat != null && p.lng != null ? distanceKm(myLoc.lat, myLoc.lng, p.lat, p.lng) : Infinity }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.p)
    }
    if (sortMode === 'rating') {
      return [...filtered].sort((a, b) => (b.naver_rating ?? -1) - (a.naver_rating ?? -1))
    }
    if (sortMode === 'reviewCount') {
      return [...filtered].sort((a, b) => (b.naver_review_count ?? -1) - (a.naver_review_count ?? -1))
    }
    return filtered
  }, [all, regionGroup, sanggwon, openNow, search, sortMode, myLoc, sangOf, groupOf])

  // 거리순일 때 각 슬롯에 현재 위치로부터의 거리를 보여준다(2026-08-25 오너 지시).
  const distanceById = useMemo(() => {
    if (!myLoc) return null
    const m = new Map<string, number>()
    for (const p of all) {
      if (p.lat != null && p.lng != null) m.set(p.id, distanceKm(myLoc.lat, myLoc.lng, p.lat, p.lng))
    }
    return m
  }, [all, myLoc])

  // 지도탭 핀 목록 — 예전엔 지도탭 렌더 안에서 매번 새로 만들어서(useMemo 없이), 이 화면의
  // 아무 상태(예: mapView — 지도를 그냥 팬/줌만 해도 onCameraIdle로 계속 바뀜)가 바뀔 때마다
  // ~500개 핀 배열·이미지 prop 객체가 전부 새로 생성됐다. PlaceMap 내부 클러스터링(useMemo)도
  // pins 참조가 바뀌었다고 보고 매번 다시 계산하고, 마커 이미지도 새 객체라 다시 로드될
  // 수 있어 — 특히 마커를 탭할 때마다(카메라 이동으로 mapView 갱신 + 클릭으로 focused 갱신
  // 이 겹쳐) 눈에 띄는 지연이 생겼다(2026-08-25 오너 지적: "업체박스 반박자 느리게 나온다").
  // 실제로 지도 이동을 껐더니 오히려 더 느리게 느껴졌다는 건 — 지연 자체는 그대로였고
  // 카메라 이동이 "탭이 먹혔다"는 즉각적 피드백 역할을 해서 지연을 가려주고 있었다는 뜻.
  // pinned·pins 를 실제로 바뀔 때만(장소 목록·선택 매장) 재계산하도록 메모해 근본 원인을 없앤다.
  const pinnedMapPlaces = useMemo(() => list.filter((p) => p.lat != null && p.lng != null), [list])
  const mapPins = useMemo(() => pinnedMapPlaces.map((p) => ({
    id: p.id,
    lat: p.lat!,
    lng: p.lng!,
    name: p.name,
    markerUrl: placeMarkerUrl(p),
    active: focused?.id === p.id,
  })), [pinnedMapPlaces, focused])

  // 스크롤하면 지역군 칩 줄이 접힌다 — 소개팅·소셜링과 동일 기준.
  const chipsAnim = useRef(new Animated.Value(1)).current
  const chipsExpandedRef = useRef(true)
  // 피드 스크롤 위치 기억 — 다른 탭 갔다가 돌아와도 보던 자리 그대로(2026-08-25 오너 지시).
  // 복원 로직은 hooks/useScrollRestore.ts 참고(세 번째 재설계 — 한 번만 판정하지 않고
  // 콘텐츠가 자랄 때마다 계속 다시 맞춘다).
  const feedListRef = useRef<FlatList<PlaceRow>>(null)
  const { restoredRef: restoredScrollRef, listVisible, onScrollBeginDrag, onContentSizeChange: restoreOnContentSizeChange } =
    useScrollRestore('honsul-feed', feedListRef)
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
    if (restoredScrollRef.current) saveScrollOffset('honsul-feed', y)
  }, [chipsAnim])

  const openOnMap = (p: PlaceRow) => {
    setFocused(p)
    // 명시적 이동 의도 — cameraTarget(실제로 지도를 그리로 옮김)과 mapView(기억용) 둘 다 갱신.
    if (p.lat != null && p.lng != null) {
      setCameraTarget({ lat: p.lat, lng: p.lng, zoom: 16 })
      setMapView({ lat: p.lat, lng: p.lng, zoom: 16 })
    }
    setTab('map')
  }

  // 적용된 필터칩 — 소개팅·소셜링과 완전히 동일한 규격(activeChip + 초기화).
  const activeChips: { label: string; onRemove: () => void }[] = []
  if (regionGroup) activeChips.push({ label: regionGroup, onRemove: () => { setRegionGroup(null); setSanggwon(null) } })
  if (sanggwon) activeChips.push({ label: sanggwon, onRemove: () => setSanggwon(null) })
  if (search) activeChips.push({ label: `‘${search}’`, onRemove: () => setSearch('') })
  const resetAll = () => { setRegionGroup(null); setSanggwon(null); setOpenNow(false); setSearch('') }

  // 현재 위치 — 필터 줄 오른쪽 버튼(예전엔 FAB였다, 2026-08-24 오너 지시로 이동).
  // 위치를 잡으면 거리순도 같이 켠다(오너 지시: "현재위치 누르면 자동으로 거리순") —
  // 다시 누르면 해제, 거리순 정렬 중이었으면 기본 정렬로 되돌린다(위치 없이는 거리순 불가).
  const toggleNearby = useCallback(async () => {
    if (myLoc) { setMyLoc(null); setCachedLocation(null); if (sortMode === 'distance') setSortMode('default'); return }
    setLocBusy(true)
    const loc = await getMyLocation()
    setLocBusy(false)
    if (loc) { applyLocation(loc); setSortMode('distance') }
  }, [myLoc, sortMode, setSortMode, applyLocation])

  // 거리순 — 위치 없으면 먼저 요청하고 나서 적용.
  const selectDistanceSort = useCallback(async () => {
    if (sortMode === 'distance') { setSortMode('default'); return }
    if (myLoc) { setSortMode('distance'); return }
    setLocBusy(true)
    const loc = await getMyLocation()
    setLocBusy(false)
    if (loc) { applyLocation(loc); setSortMode('distance') }
  }, [sortMode, myLoc, setSortMode, applyLocation])

  const selectRatingSort = () => setSortMode(sortMode === 'rating' ? 'default' : 'rating')
  // 리뷰많은순 — 위치 필요 없음, naver_review_count 기준(2026-08-24 오너 지시).
  const selectReviewCountSort = () => setSortMode(sortMode === 'reviewCount' ? 'default' : 'reviewCount')

  return (
    <View style={styles.container}>
      {/* ⚠️(2026-08-26) onLogoPress 를 안 넘기면 TopBar 기본 동작(5탭 개편 이전
          segment='event'|'board' 2분법)이 무조건 소개팅 홈(/)으로 보낸다 — 혼술바
          화면(특히 지도보기 상태)에서 로고를 눌러도 소개팅으로 튕겼다(오너 지시:
          "혼술바는 지도보기 상태에서 눌렀을때도 서브홈으로 가게 해라"). 이미 혼술바
          안에 있으니 다른 화면으로 이동할 필요 없이 목록(피드) 탭으로만 되돌린다. */}
      <TopBar onSearchPress={() => setSearchVisible(true)} onLogoPress={() => setTab('feed')} />

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

          {/* 정렬(거리순·평점순, 왼쪽) + 영업중·현재 위치(오른쪽) — 소개팅 정렬칩(날짜순 등)과
              완전히 동일한 규격(2026-08-24 오너 지시: "날짜순 그거랑 같게"). */}
          <View style={styles.resultRow}>
            <TouchableOpacity
              style={[styles.sortChip, sortMode === 'distance' && styles.sortChipActive]}
              onPress={selectDistanceSort} disabled={locBusy}
            >
              <Text style={[styles.sortChipText, sortMode === 'distance' && styles.sortChipTextActive]}>
                {locBusy && sortMode !== 'distance' ? '위치 확인중' : '거리순'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sortChip, sortMode === 'rating' && styles.sortChipActive]} onPress={selectRatingSort}>
              <Text style={[styles.sortChipText, sortMode === 'rating' && styles.sortChipTextActive]}>평점순</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sortChip, sortMode === 'reviewCount' && styles.sortChipActive]} onPress={selectReviewCountSort}>
              <Text style={[styles.sortChipText, sortMode === 'reviewCount' && styles.sortChipTextActive]}>리뷰많은순</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={[styles.sortChip, styles.excludeChip, openNow && styles.excludeChipActive]} onPress={() => setOpenNow(!openNow)}>
              <View style={[styles.checkbox, openNow && styles.checkboxOn]}>
                {openNow && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}
              </View>
              <Text style={[styles.sortChipText, openNow && styles.sortChipTextActive]}>영업중</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.locBtn, myLoc && styles.locBtnOn]} onPress={toggleNearby} activeOpacity={0.8} disabled={locBusy}>
              <Ionicons name={myLoc ? 'navigate' : 'navigate-outline'} size={13} color={myLoc ? colors.primary : colors.textSecondary} />
              <Text style={[styles.sortChipText, myLoc && styles.sortChipTextActive]}>
                {locBusy && !myLoc ? '위치 확인중' : '현재 위치'}
              </Text>
            </TouchableOpacity>
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
              ref={feedListRef}
              style={{ opacity: listVisible ? 1 : 0 }}
              data={list}
              keyExtractor={(p) => p.id}
              renderItem={({ item }) => (
                <PlaceListItem place={item} onMapPress={openOnMap}
                  distanceKm={sortMode === 'distance' ? distanceById?.get(item.id) : undefined}
                  isFavorite={favoriteIds.has(item.id)} onToggleFavorite={() => confirmFavorite(favoriteIds.has(item.id), () => toggleFav(item.id))} />
              )}
              onScroll={onFeedScroll}
              onScrollBeginDrag={onScrollBeginDrag}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 96 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={restoreOnContentSizeChange}
            />
          )}

          {/* 지도 보기 FAB — 예전엔 상단 고정 탭이었다(2026-08-24 오너 지시로 하단 플로팅으로
              이동). 배경은 앱 전체 FAB 규격(board 글쓰기 버튼)과 동일하게 primary 핑크로
              통일 — 처음에 검정/흰색으로 했던 건 오너 지적으로 되돌림. 내 주변 버튼은
              필터 줄(현재 위치)로 옮겼다. */}
          <View style={[styles.fabStack, { bottom: insets.bottom + 14 }]}>
            <TouchableOpacity style={styles.fabPrimary} onPress={() => setTab('map')} activeOpacity={0.85}>
              <Ionicons name="map-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        /* 지도 탭 — 네이버 지도(재빌드 후). 네이티브 모듈 없으면 안내로 폴백. */
        <View style={{ flex: 1 }}>
          {(() => {
            const pinned = pinnedMapPlaces
            // ⚠️(2026-08-25) cameraTarget(지도에 "여기로 가라"고 명령하는 값)과 mapView(그냥
            // 기억만 해두는 값)를 반드시 분리해야 한다 — 처음엔 같은 값(mapView)을 both로
            // 쓰다가 무한루프에 빠졌다: onCameraIdle → setMapView → center 재계산 → focus
            // prop 변경 → PlaceMap이 "다시 이동해라"로 착각 → animateCameraTo → 또 idle →
            // 또 setMapView… 그 결과가 "확대한 위치 안에서 혼자 왔다갔다"였다(오너 지적).
            // cameraTarget은 오직 "마커를 명시적으로 눌렀을 때"만 바뀐다(최초 진입 값은 mount
            // 시점에 한 번만 mapView 에서 읽어온다) — 자유 팬/줌은 mapView(기억용)만 갱신하고
            // cameraTarget/focus prop 은 절대 건드리지 않는다.
            const center = cameraTarget ?? (pinned[0]?.lat != null ? { lat: pinned[0].lat!, lng: pinned[0].lng!, zoom: 12 } : null)
            if (NAVER_MAP_AVAILABLE && center) {
              return (
                <>
                  <PlaceMap
                    style={{ flex: 1 }}
                    focus={{ lat: center.lat, lng: center.lng }}
                    zoom={center.zoom}
                    showLocationButton
                    cluster
                    // 마커 탭하면 카메라도 같이 줌인 이동(오너 승인 — "줌인 효과는 있는게
                    // 좋긴하겠다"). 예전엔 이게 "박스가 늦게 뜨는" 원인인 줄 알고 빼봤는데,
                    // 빼니 오히려 더 느리게 느껴졌다 — 진짜 원인은 이게 아니라 pins 배열이
                    // 매번 새로 생성되던 것(위 mapPins useMemo 주석 참고)이었다. 그건 고쳤으니
                    // 줌인은 도로 살린다.
                    onTapPin={(id) => {
                      const p = pinned.find((p) => p.id === id) ?? null
                      setFocused(p)
                      if (p?.lat != null && p?.lng != null) setCameraTarget({ lat: p.lat, lng: p.lng, zoom: 16 })
                    }}
                    onTapBackground={() => setFocused(null)}
                    // 마커를 안 눌러도 자유롭게 팬/줌한 위치까지 "기억만"(mapView, 다음에 다시
                    // 들어올 때 복원용) — cameraTarget 은 안 건드려서 루프를 안 만든다.
                    onCameraIdle={setMapView}
                    pins={mapPins}
                  />
                  {focused && (
                    <PlaceMapCard
                      place={focused}
                      isFavorite={favoriteIds.has(focused.id)}
                      onToggleFavorite={() => confirmFavorite(favoriteIds.has(focused.id), () => toggleFav(focused.id))}
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
              <Ionicons name="list-outline" size={22} color="#fff" />
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
    // 지도 보기 FAB — 우하단(2026-08-24 오너 지시). 콘텐츠 위에 뜨는 플로팅이라
    // board 글쓰기 FAB과 같은 그림자를 준다(하단 고정바와는 다름). 배경은 앱 전체
    // FAB 규격(colors.primary)과 통일 — 처음 검정/흰색으로 했던 건 오너 지적으로 되돌림.
    fabStack: { position: 'absolute', right: 16, alignItems: 'center', gap: 10 },
    fabPrimary: {
      width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary,
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
    // paddingRight 16 — 아래 카드(PlaceListItem)가 marginHorizontal:16 이라 오른쪽 끝이
    // 카드와 일직선으로 맞아야 한다(2026-08-24 오너 지적: "빈공간이 카드슬롯이랑 라인이 안맞다").
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 16, paddingVertical: 6 },
    sortChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
    sortChipActive: { backgroundColor: '#FF6B9D18', borderColor: colors.primary },
    sortChipText: { fontSize: 12, color: colors.textTertiary, fontWeight: '500' },
    sortChipTextActive: { color: colors.primary, fontWeight: '700' },
    excludeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 2 },
    excludeChipActive: { backgroundColor: '#FF6B9D18', borderColor: colors.primary, paddingLeft: 10 },
    // 현재 위치 — 정렬·영업중과 같은 줄 가장 오른쪽(2026-08-24 오너 지시, FAB에서 이동).
    // sortChip과 완전히 같은 규격(테두리·패딩)으로 통일(오너 지적: "거리순 칩이랑 디자인이 다르다").
    locBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
    locBtnOn: { backgroundColor: '#FF6B9D18', borderColor: colors.primary },
    checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
    chip: { paddingHorizontal: 13, paddingVertical: 5, borderRadius: 18, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
    chipTextOn: { color: '#fff', fontWeight: '700' },
    countRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
    tagFilterChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${colors.primary}1a`, borderRadius: 12, paddingLeft: 9, paddingRight: 6, paddingVertical: 3 },
    tagFilterText: { fontSize: 12, color: colors.primary, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 60, paddingHorizontal: 30 },
    emptyText: { fontSize: 15, color: colors.textSecondary, marginTop: 4 },
    emptySub: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', lineHeight: 20 },
  })
}
