import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import ReviewSection from '@/components/ReviewSection'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'
import {
  fetchPlace, fetchPlaceReviews, fetchNearbyCoords, openStatus, reviewHashtags,
  osmTiles, type PlaceRow, type PlaceReview,
} from '@/lib/places'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'

const DOW = ['월', '화', '수', '목', '금', '토', '일']
const MAP_W = Dimensions.get('window').width
const MAP_H = 200

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [place, setPlace] = useState<PlaceRow | null>(null)
  const [reviews, setReviews] = useState<PlaceReview[]>([])
  const [nearby, setNearby] = useState<{ lat: number | null; lng: number | null }[]>([])
  const [showNearby, setShowNearby] = useState(false)
  const [loading, setLoading] = useState(true)
  const { favoriteIds, toggle } = usePlaceFavorites()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const p = await fetchPlace(String(id))
        if (!alive) return
        setPlace(p)
        setReviews(await fetchPlaceReviews(String(id)))
        if (p?.lat) setNearby(await fetchNearbyCoords(String(id)))
      } catch { /* 무시 */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [id])

  if (loading) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><AppSpinner /></View></View>
  if (!place) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><Text style={styles.muted}>매장을 찾을 수 없어요</Text></View></View>

  const { open, hoursLabel } = openStatus(place.hours)
  const isFav = favoriteIds.has(place.id)
  const hashtags = reviewHashtags(place.keyword_votes)
  const media = place.instagram_media ?? []

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* 히어로 = 지도(무료 OSM 타일. 네이버 지도 SDK 연동[재빌드] 후 교체) */}
        {place.lat && place.lng ? (
          <View style={styles.mapImg}>
            {(() => {
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
            })()}
            <TouchableOpacity style={styles.nearbyChk} onPress={() => setShowNearby((v) => !v)} activeOpacity={0.8}>
              <View style={[styles.checkbox, showNearby && styles.checkboxOn]}>{showNearby && <Ionicons name="checkmark-sharp" size={12} color="#fff" />}</View>
              <Text style={styles.nearbyText}>주변 혼술바도 보기</Text>
            </TouchableOpacity>
          </View>
        ) : <View style={[styles.mapImg, styles.mapEmpty]}><Ionicons name="map-outline" size={40} color={colors.textTertiary} /></View>}

        <View style={styles.body}>
          {/* 업체명 + 찜(오른쪽 끝) */}
          <View style={styles.nameRow}>
            <Text style={styles.name}>{place.name}</Text>
            <TouchableOpacity onPress={() => toggle(place.id)} hitSlop={8} activeOpacity={0.8}>
              <Ionicons name="heart" size={22} color={isFav ? '#FF6B9D' : colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* 업체명 밑 = 피드와 동일 */}
          {hashtags.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow}>
              {hashtags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}
            </ScrollView>
          )}
          <View style={styles.metaRow}>
            {open != null ? (
              <>
                <Text style={[styles.op, { color: open ? colors.success : colors.textTertiary }]}>{open ? '영업중' : '영업종료'}</Text>
                {hoursLabel && <Text style={styles.hours}>{'  '}{hoursLabel}</Text>}
              </>
            ) : <Text style={styles.hours}>영업시간 정보 없음</Text>}
            <Text style={styles.meta}>{'  ·  '}{place.region ?? ''}{place.naver_rating ? `  ·  ★ ${place.naver_rating}` : ''}</Text>
          </View>
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
        </View>

        {/* 방문자 키워드(네이버·사실) */}
        {place.keyword_votes && (
          <View style={styles.revBox}>
            <Text style={styles.revTitle}>방문자 키워드</Text>
            <View style={styles.revChips}>
              {Object.entries(place.keyword_votes).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => (
                <View key={k} style={styles.revChip}><Text style={styles.revChipText}>{k} <Text style={styles.revCount}>{c}</Text></Text></View>
              ))}
            </View>
          </View>
        )}

        {/* 후기 — 소개팅과 동일 디자인(ReviewSection) */}
        <View style={{ marginTop: 6 }}>
          <ReviewSection
            reviews={reviews as unknown as ReviewRow[]}
            myReviewIds={[]}
            onEdit={() => {}} onDelete={() => {}} onReport={() => {}}
          />
        </View>
      </ScrollView>
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
    nearbyChk: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 16, paddingLeft: 8, paddingRight: 12, paddingVertical: 6 },
    checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    nearbyText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
    infoRow: { flexDirection: 'row', paddingVertical: 7, gap: 10 },
    infoK: { width: 40, color: colors.textTertiary, fontSize: 13.5, fontWeight: '700', lineHeight: 21 },
    infoV: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 21 },
    telRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    revBox: { marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
    revTitle: { fontSize: 12, fontWeight: '800', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    revChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    revChip: { backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
    revChipText: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' },
    revCount: { color: colors.primary, fontWeight: '800' },
  })
}
