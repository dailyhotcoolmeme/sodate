import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking, Dimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlace, cleanImageUrl, openStatus, type PlaceRow } from '@/lib/places'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'

const DOW = ['월', '화', '수', '목', '금', '토', '일']
const SCREEN_W = Dimensions.get('window').width

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [place, setPlace] = useState<PlaceRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgIdx, setImgIdx] = useState(0)
  const { favoriteIds, toggle } = usePlaceFavorites()

  useEffect(() => {
    let alive = true
    ;(async () => {
      try { const p = await fetchPlace(String(id)); if (alive) setPlace(p) }
      catch { /* 무시 */ } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [id])

  if (loading) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><AppSpinner /></View></View>
  if (!place) return <View style={styles.container}><TopBar showBack /><View style={styles.center}><Text style={styles.muted}>매장을 찾을 수 없어요</Text></View></View>

  const gallery = (place.images?.length ? place.images : [place.thumbnail_url])
    .map(cleanImageUrl)
    .filter((u): u is string => !!u)
  const { open } = openStatus(place.hours)
  const isFav = favoriteIds.has(place.id)
  const onGalleryScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W)
    if (i !== imgIdx) setImgIdx(i)
  }
  const tags = [...place.honsul_badges, ...place.mood_tags]
  const votes = place.keyword_votes
    ? Object.entries(place.keyword_votes).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : []

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}>
        {/* 히어로 갤러리 — 네이버 대표사진 여러 장 스와이프 */}
        {gallery.length > 0 ? (
          <View>
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              onScroll={onGalleryScroll} scrollEventThrottle={16}
            >
              {gallery.map((u, i) => (
                <Image key={u + i} source={{ uri: u }} style={styles.heroImg} resizeMode="cover" />
              ))}
            </ScrollView>
            {gallery.length > 1 && (
              <>
                <View style={styles.counter}><Text style={styles.counterText}>{imgIdx + 1} / {gallery.length}</Text></View>
                <View style={styles.dots}>
                  {gallery.map((_, i) => <View key={i} style={[styles.dot, i === imgIdx && styles.dotOn]} />)}
                </View>
              </>
            )}
          </View>
        ) : (
          <View style={[styles.heroImg, styles.heroEmpty]}><Ionicons name="wine-outline" size={44} color={colors.textTertiary} /></View>
        )}

        <View style={styles.body}>
          {place.category && <View style={styles.catBadge}><Text style={styles.catBadgeText}>{place.category}</Text></View>}
          <Text style={styles.name}>{place.name}</Text>
          <Text style={styles.sub}>
            {place.region ?? '서울'}
            {open != null && <Text style={{ color: open ? colors.success : colors.textTertiary, fontWeight: '800' }}>{'  ·  '}{open ? '영업중' : '영업종료'}</Text>}
          </Text>

          {tags.length > 0 && (
            <View style={styles.tagWrap}>{tags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}</View>
          )}

          {/* 정보 */}
          <View style={styles.card}>
            {place.hours && Object.keys(place.hours).length > 0 && (
              <View style={styles.infoRow}>
                <Text style={styles.infoK}>영업</Text>
                <View style={{ flex: 1 }}>
                  {DOW.filter((d) => place.hours![d]).map((d) => (
                    <Text key={d} style={styles.infoV}>{d}  {place.hours![d]!.replace('~', '–')}</Text>
                  ))}
                </View>
              </View>
            )}
            {place.address_road && <View style={styles.infoRow}><Text style={styles.infoK}>주소</Text><Text style={styles.infoV}>{place.address_road}</Text></View>}
            {place.tel && <View style={styles.infoRow}><Text style={styles.infoK}>전화</Text><Text style={styles.infoV}>{place.tel}</Text></View>}
            {place.conveniences.length > 0 && <View style={styles.infoRow}><Text style={styles.infoK}>편의</Text><Text style={styles.infoV}>{place.conveniences.join(' · ')}</Text></View>}
          </View>

          {/* 리뷰 요약 — 네이버 키워드 투표(사실) */}
          {votes.length > 0 && (
            <View style={styles.revBox}>
              <Text style={styles.revTitle}>방문자 키워드</Text>
              <View style={styles.revChips}>
                {votes.map(([k, c]) => (
                  <View key={k} style={styles.revChip}><Text style={styles.revChipText}>{k} <Text style={styles.revCount}>{c}</Text></Text></View>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* 하단 액션바 */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 8 }]}>
        <Act icon={isFav ? 'heart' : 'heart-outline'} label="저장" active={isFav} onPress={() => toggle(place.id)} styles={styles} colors={colors} />
        {place.tel && <Act icon="call-outline" label="전화" onPress={() => Linking.openURL(`tel:${place.tel}`)} styles={styles} colors={colors} />}
        <Act icon="navigate-outline" label="길찾기" onPress={() => openOutlink(mapUrl(place))} styles={styles} colors={colors} />
        {place.naver_url && (
          <TouchableOpacity style={styles.actPrimary} onPress={() => openOutlink(place.naver_url!)} activeOpacity={0.85}>
            <Text style={styles.actPrimaryText}>원본 보기 ›</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

function mapUrl(p: PlaceRow): string {
  // 카카오맵 길찾기(웹) — 좌표+이름. 카카오맵 앱 설치 시 앱으로 열림.
  if (p.lat && p.lng) return `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}`
  return `https://map.kakao.com/?q=${encodeURIComponent(p.name)}`
}

function Act({ icon, label, active, onPress, styles, colors }: { icon: any; label: string; active?: boolean; onPress: () => void; styles: any; colors: AppColors }) {
  return (
    <TouchableOpacity style={styles.act} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[styles.actLabel, active && { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.textTertiary, fontSize: 14 },
    heroImg: { width: SCREEN_W, height: 260, backgroundColor: colors.surfaceHigh },
    heroEmpty: { alignItems: 'center', justifyContent: 'center' },
    counter: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 },
    counterText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
    dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
    dotOn: { backgroundColor: '#fff', width: 7, height: 7, borderRadius: 3.5 },
    body: { padding: 16 },
    catBadge: { alignSelf: 'flex-start', backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, marginBottom: 7 },
    catBadgeText: { fontSize: 12, fontWeight: '800', color: colors.primary },
    name: { fontSize: 21, fontWeight: '800', color: colors.textPrimary, marginBottom: 5 },
    sub: { fontSize: 13.5, color: colors.textSecondary, marginBottom: 12 },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
    tag: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    card: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider, paddingVertical: 6, marginBottom: 16 },
    infoRow: { flexDirection: 'row', paddingVertical: 8, gap: 12 },
    infoK: { width: 44, color: colors.textTertiary, fontSize: 13, fontWeight: '700' },
    infoV: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 21 },
    revBox: { backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
    revTitle: { fontSize: 12, fontWeight: '800', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    revChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    revChip: { backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
    revChipText: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' },
    revCount: { color: colors.primary, fontWeight: '800' },
    actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
    act: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 4 },
    actLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
    actPrimary: { flex: 1, marginLeft: 6, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    actPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  })
}
