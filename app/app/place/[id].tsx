import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Dimensions, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import ReviewSection from '@/components/ReviewSection'
import ReviewSheet, { type ReviewSheetInitial } from '@/components/ReviewSheet'
import ReportSheet from '@/components/ReportSheet'
import PlaceMap, { NAVER_MAP_AVAILABLE } from '@/components/PlaceMap'
import PlaceMapCard from '@/components/PlaceMapCard'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'
import {
  fetchPlace, fetchPlaceReviews, fetchNearbyPlaces, openStatus,
  osmTiles, type PlaceRow, type PlaceReview,
} from '@/lib/places'
import { deletePlaceReview } from '@/lib/placeReviews'
import { getMyReviewIds } from '@/lib/reviewIdentity'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { addRecentView } from '@/lib/recentViews'

const DOW = ['월', '화', '수', '목', '금', '토', '일']
const MAP_W = Dimensions.get('window').width
const MAP_H = 200

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [place, setPlace] = useState<PlaceRow | null>(null)
  const [reviews, setReviews] = useState<PlaceReview[]>([])
  // 주변 매장 — 전체 정보(이름·사진·평점 등)를 좌표와 함께 한 번에 받아둔다. 예전엔
  // 좌표만 받고 탭할 때마다 fetchPlace() 로 또 네트워크를 타서 카드가 "한참 뒤에" 떴다
  // (2026-08-24 오너 지적) — 이제 탭하면 이미 메모리에 있는 값을 즉시 보여준다.
  const [nearby, setNearby] = useState<PlaceRow[]>([])
  const [showNearby, setShowNearby] = useState(false)
  const [loading, setLoading] = useState(true)
  const { favoriteIds, toggle } = usePlaceFavorites()
  // 주변 핀을 누르면 바로 이동이 아니라, 어느 가게인지 미리보기 카드로 보여주고 "상세보기"를
  // 눌러야 이동한다(2026-08-24 오너 지적 — "이 가게가 어느 가게인지 보고 이동할지 선택해야
  // 할 거 아니야"). 지도탭(honsul/index.tsx)의 PlaceMapCard 와 완전히 같은 패턴 재사용.
  const [previewPlace, setPreviewPlace] = useState<PlaceRow | null>(null)
  const onTapNearbyPin = useCallback((tappedId: string) => {
    if (!place || tappedId === place.id) return
    const p = nearby.find((n) => n.id === tappedId)
    if (p) setPreviewPlace(p)
  }, [place, nearby])

  // 후기 작성/수정 시트 + 내 후기 식별 + 신고 (소개팅 event/[id] 와 동일 흐름)
  const [sheetVisible, setSheetVisible] = useState(false)
  const [editTarget, setEditTarget] = useState<ReviewSheetInitial | null>(null)
  const [myReviewIds, setMyReviewIds] = useState<string[]>([])
  const [reportTarget, setReportTarget] = useState<string | null>(null)

  const loadMyReviewIds = useCallback(() => { getMyReviewIds().then(setMyReviewIds) }, [])
  const refetchReviews = useCallback(async () => {
    if (id) setReviews(await fetchPlaceReviews(String(id)))
  }, [id])

  useEffect(() => {
    // 화면(id)이 바뀌는 순간 이전 화면의 미리보기 카드·주변 표시가 남아있으면 안 된다.
    setPreviewPlace(null)
    setShowNearby(false)
    let alive = true
    ;(async () => {
      try {
        const p = await fetchPlace(String(id))
        if (!alive) return
        setPlace(p)
        setReviews(await fetchPlaceReviews(String(id)))
        if (p?.lat) setNearby(await fetchNearbyPlaces(String(id)))
      } catch { /* 무시 */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [id])

  useEffect(() => { loadMyReviewIds() }, [loadMyReviewIds])

  // MY '최근 본 기록' 기록(2026-08-24) — 로컬 저장, 무해. 이전엔 이 화면만 누락돼 있었다.
  useEffect(() => {
    if (place) {
      addRecentView({
        kind: 'place', id: place.id, title: place.name,
        sub: place.region ?? undefined,
      })
    }
  }, [place?.id])

  const openWrite = () => { setEditTarget(null); setSheetVisible(true) }
  const openEdit = (review: ReviewRow) => {
    setEditTarget({ id: review.id, author_name: review.author_name, rating: review.rating, content: review.content, gender: review.gender })
    setSheetVisible(true)
  }
  const handleSheetDone = () => { loadMyReviewIds(); refetchReviews() }
  const handleDelete = async (review: ReviewRow) => {
    const result = await deletePlaceReview(review.id)
    if ('error' in result) { Alert.alert('삭제 실패', result.error); return }
    loadMyReviewIds(); refetchReviews()
  }
  const handleReport = (review: ReviewRow) => { setReportTarget(review.id) }

  if (loading) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><AppSpinner /></View></View>
  if (!place) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><Text style={styles.muted}>매장을 찾을 수 없어요</Text></View></View>

  const { open, hoursLabel } = openStatus(place.hours)
  const isFav = favoriteIds.has(place.id)
  const media = place.instagram_media ?? []

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* 히어로 = 네이버 지도(재빌드 후). 아직 네이티브 모듈 없으면 OSM 타일로 폴백. */}
        {place.lat && place.lng ? (
          <View style={styles.mapImg}>
            {NAVER_MAP_AVAILABLE ? (
              <PlaceMap
                style={StyleSheet.absoluteFill}
                focus={{ lat: place.lat, lng: place.lng }}
                hideBasePoi
                compactPins
                // 주변 점 누르면 바로 이동이 아니라 미리보기 카드부터(2026-08-24 오너 지적).
                onTapPin={onTapNearbyPin}
                // 박스 바깥(지도 빈 공간) 누르면 미리보기 카드 닫힘(2026-08-24 오너 지적).
                onTapBackground={() => setPreviewPlace(null)}
                pins={[
                  { id: place.id, lat: place.lat, lng: place.lng, name: place.name, active: true },
                  ...(showNearby
                    ? nearby.flatMap((o) => (o.lat && o.lng ? [{ id: o.id, lat: o.lat, lng: o.lng }] : []))
                    : []),
                ]}
              />
            ) : (
              (() => {
                const { tiles, project } = osmTiles(place.lat, place.lng, MAP_W, MAP_H)
                const me = project(place.lat, place.lng)
                return (
                  <>
                    {tiles.map((t, i) => <Image key={i} source={{ uri: t.url }} style={[styles.tile, { left: t.left, top: t.top }]} />)}
                    {showNearby && nearby.map((o, i) => {
                      if (!o.lat || !o.lng) return null
                      const q = project(o.lat, o.lng)
                      if (q.x < -8 || q.x > MAP_W + 8 || q.y < -8 || q.y > MAP_H + 8) return null
                      return <View key={i} style={[styles.pinDot, { left: q.x - 5, top: q.y - 5 }]} />
                    })}
                    <View style={[styles.pinMe, { left: me.x - 13, top: me.y - 26 }]}><Ionicons name="location" size={26} color="#FF6B9D" /></View>
                  </>
                )
              })()
            )}
            <TouchableOpacity
              style={styles.nearbyChk}
              onPress={() => { setShowNearby((v) => !v); setPreviewPlace(null) }}
              activeOpacity={0.8}
            >
              <View style={[styles.checkbox, showNearby && styles.checkboxOn]}>{showNearby && <Ionicons name="checkmark-sharp" size={11} color="#fff" />}</View>
              <Text style={styles.nearbyText}>주변 혼술바</Text>
            </TouchableOpacity>
            {previewPlace && (
              <PlaceMapCard
                place={previewPlace}
                isFavorite={favoriteIds.has(previewPlace.id)}
                onToggleFavorite={() => toggle(previewPlace.id)}
                onOpen={() => { const pid = previewPlace.id; setPreviewPlace(null); router.push(`/place/${pid}`) }}
                onClose={() => setPreviewPlace(null)}
              />
            )}
          </View>
        ) : <View style={[styles.mapImg, styles.mapEmpty]}><Ionicons name="map-outline" size={40} color={colors.textTertiary} /></View>}

        <View style={styles.body}>
          {/* 업체명 + 찜(오른쪽 끝) */}
          <View style={styles.nameRow}>
            <Text style={styles.name}>{place.name}</Text>
            <TouchableOpacity onPress={() => toggle(place.id)} hitSlop={8} activeOpacity={0.8}>
              <Ionicons name="bookmark" size={22} color={isFav ? '#FF6B9D' : colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* 상세에선 상단 해시태그 대신 아래 정보카드의 '키워드' 행으로 보여준다(오너 지시). */}
          <View style={styles.metaRow}>
            {open != null ? (
              <>
                <Text style={[styles.op, { color: open ? colors.success : colors.textTertiary }]}>{open ? '영업중' : '영업종료'}</Text>
                {hoursLabel && <Text style={styles.hours}>{'  '}{hoursLabel}</Text>}
              </>
            ) : <Text style={styles.hours}>영업시간 정보 없음</Text>}
            <Text style={styles.meta}>{'  ·  '}{place.region ?? ''}</Text>
          </View>

          {/* 평점 — 네이버 플레이스에서 점수·리뷰수만 가져온다(내용은 안 긁음, 2026-08-24
              오너 지시). 리뷰 내용이 궁금하면 네이버 플레이스로 보낸다. */}
          {place.naver_rating != null && (
            <TouchableOpacity
              style={styles.ratingRow}
              activeOpacity={place.naver_url ? 0.7 : 1}
              disabled={!place.naver_url}
              onPress={() => place.naver_url && openOutlink(place.naver_url)}
            >
              <Ionicons name="star" size={14} color="#FFB800" />
              <Text style={styles.ratingScore}>{place.naver_rating.toFixed(2)}</Text>
              {place.naver_review_count != null && (
                <Text style={styles.ratingCount}>리뷰 {place.naver_review_count.toLocaleString()}개</Text>
              )}
              {place.naver_url && (
                <Text style={styles.ratingLink}>네이버 플레이스에서 보기 ›</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* 이 가게 인스타 */}
        {media.length > 0 && (
          <View style={styles.igSection}>
            <View style={styles.igHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="logo-instagram" size={16} color={colors.textPrimary} />
                <Text style={styles.igTitle}>이 가게 인스타</Text>
              </View>
              {place.instagram && <TouchableOpacity onPress={() => openOutlink(place.instagram!)}><Text style={styles.igAll}>전체 보기 ›</Text></TouchableOpacity>}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.igScroll}>
              {media.map((m) => (
                <TouchableOpacity key={m.code} activeOpacity={0.85} onPress={() => openOutlink(m.url)}>
                  <View style={styles.igItem}>
                    {m.thumb ? <Image source={{ uri: m.thumb }} style={styles.igImg} /> : <View style={[styles.igImg, styles.igEmpty]} />}
                    {m.is_reel && <View style={styles.igReel}><Ionicons name="play" size={12} color="#fff" /></View>}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 정보 */}
        <View style={styles.card}>
          {place.hours && Object.keys(place.hours).length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoK}>영업</Text>
              <View style={{ flex: 1 }}>{DOW.filter((d) => place.hours![d]).map((d) => <Text key={d} style={styles.infoV}>{d}  {place.hours![d]!.replace('~', '–')}</Text>)}</View>
            </View>
          )}
          {place.address_road && <View style={styles.infoRow}><Text style={styles.infoK}>주소</Text><Text style={styles.infoV}>{place.address_road}</Text></View>}
          {place.tel && (
            <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(`tel:${place.tel}`)} activeOpacity={0.7}>
              <Text style={styles.infoK}>전화</Text>
              <View style={styles.telRow}><Text style={styles.infoV}>{place.tel}</Text><Ionicons name="call" size={14} color={colors.primary} /></View>
            </TouchableOpacity>
          )}
          {place.conveniences.length > 0 && <View style={styles.infoRow}><Text style={styles.infoK}>편의</Text><Text style={styles.infoV}>{place.conveniences.join(' · ')}</Text></View>}
          {/* 방문자 키워드 = 네이버 방문자 투표(사실). 별도 박스 대신 같은 라벨-내용 레이어. */}
          {place.keyword_votes && Object.keys(place.keyword_votes).length > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoK}>키워드</Text>
              <View style={styles.kwWrap}>
                {Object.entries(place.keyword_votes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => (
                  <View key={k} style={styles.kwChip}><Text style={styles.kwChipText}>{k} <Text style={styles.kwCount}>{c}</Text></Text></View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* 후기 — 소개팅과 동일 디자인(ReviewSection) + 작성/수정/삭제/신고 */}
        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>후기</Text>
            <TouchableOpacity style={styles.writeInline} onPress={openWrite} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="create-outline" size={16} color={colors.primary} />
              <Text style={styles.writeInlineText}>후기 작성</Text>
            </TouchableOpacity>
          </View>
          <ReviewSection
            reviews={reviews as unknown as ReviewRow[]}
            myReviewIds={myReviewIds}
            onEdit={openEdit}
            onDelete={handleDelete}
            onReport={handleReport}
          />
        </View>
      </ScrollView>

      <ReviewSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        placeId={place.id}
        initial={editTarget}
        onDone={handleSheetDone}
      />
      <ReportSheet
        visible={reportTarget !== null}
        reviewId={reportTarget}
        placeReview
        onClose={() => setReportTarget(null)}
        onReported={(already) => {
          Alert.alert('신고되었습니다', already ? '이미 신고한 후기입니다.' : '검토 후 조치하겠습니다.')
        }}
      />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.textTertiary, fontSize: 14 },
    mapImg: { width: MAP_W, height: MAP_H, backgroundColor: '#e8e8ec', overflow: 'hidden' },
    mapEmpty: { alignItems: 'center', justifyContent: 'center' },
    tile: { position: 'absolute', width: 256, height: 256 },
    pinMe: { position: 'absolute' },
    pinDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#5b9dff', borderWidth: 1.5, borderColor: '#fff' },
    // 지도 위 오버레이 칩 — 예전엔 검은 반투명 알약이라 앱 전체 톤(밝은 카드+테두리)과
    // 따로 놀았다("완전 개판", 2026-08-24 오너 지적). 혼술바 필터줄의 '영업중' 칩과 같은
    // 흰 카드+테두리+그림자로 통일.
    nearbyChk: {
      position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.surface, borderRadius: 16, paddingLeft: 8, paddingRight: 12, paddingVertical: 6,
      borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
    },
    checkbox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: colors.textTertiary, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    nearbyText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
    body: { padding: 16, paddingBottom: 6 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.textPrimary },
    tagScroll: { height: 18, flexGrow: 0, flexShrink: 0, marginTop: 8 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tag: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    op: { fontSize: 13, fontWeight: '800' },
    hours: { fontSize: 13, color: colors.textTertiary, fontWeight: '600' },
    meta: { fontSize: 13, color: colors.textSecondary },
    // 평점 줄 — 네이버 플레이스 점수·리뷰수 + 링크(2026-08-24 오너 지시)
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    ratingScore: { fontSize: 13.5, fontWeight: '800', color: colors.textPrimary },
    ratingCount: { fontSize: 12.5, color: colors.textTertiary, marginLeft: 2 },
    ratingLink: { fontSize: 12, color: colors.primary, fontWeight: '700', marginLeft: 6 },
    igSection: { paddingTop: 6, paddingBottom: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider },
    igHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10, marginTop: 8 },
    igTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    igAll: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    igScroll: { paddingHorizontal: 16, gap: 8 },
    igItem: { position: 'relative' },
    igImg: { width: 132, height: 132, borderRadius: 12, backgroundColor: colors.surfaceHigh },
    igEmpty: { alignItems: 'center', justifyContent: 'center' },
    igReel: { position: 'absolute', top: 7, right: 7, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 3 },
    card: { margin: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider, paddingVertical: 6 },
    // 라벨·내용 첫 줄 baseline 일치 — 같은 fontSize·lineHeight.
    // 라벨·내용 첫 줄 baseline 일치. 키워드(3자) 들어가게 폭 46.
    infoRow: { flexDirection: 'row', paddingVertical: 7, gap: 10 },
    infoK: { width: 46, color: colors.textTertiary, fontSize: 13.5, fontWeight: '700', lineHeight: 21 },
    infoV: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 21 },
    telRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    kwWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    kwChip: { backgroundColor: colors.surfaceHigh, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
    kwChipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    kwCount: { color: colors.primary, fontWeight: '800' },
    // 후기 섹션 헤더 — 소개팅 event/[id] 와 동일(제목 왼쪽, 연필+글자 오른쪽)
    reviewsSection: { paddingHorizontal: 20, paddingTop: 10, marginTop: 6 },
    reviewsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    writeInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    writeInlineText: { fontSize: 14, color: colors.primary, fontWeight: '700' },
  })
}
