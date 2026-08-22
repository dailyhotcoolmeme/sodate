import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { fetchPlace, openStatus, categoryCover, socialLinks, type PlaceRow } from '@/lib/places'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'

const DOW = ['월', '화', '수', '목', '금', '토', '일']

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [place, setPlace] = useState<PlaceRow | null>(null)
  const [loading, setLoading] = useState(true)
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

  const { open } = openStatus(place.hours)
  const cover = categoryCover(place.category)
  const isFav = favoriteIds.has(place.id)
  const tags = [...place.honsul_badges, ...place.mood_tags]
  const socials = socialLinks(place)
  const media = place.instagram_media ?? []
  const votes = place.keyword_votes
    ? Object.entries(place.keyword_votes).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : []

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}>
        {/* 헤더 — 큰 사진 없이 종류색 배너 + 이름 */}
        <View style={[styles.banner, { backgroundColor: cover.bg }]}><Ionicons name={cover.icon as any} size={40} color={cover.tint} /></View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            {place.category && <View style={styles.catBadge}><Text style={styles.catBadgeText}>{place.category}</Text></View>}
            {socials.map((s) => (
              <TouchableOpacity key={s.key} hitSlop={6} onPress={() => Linking.openURL(s.url)}>
                <Ionicons name={s.icon as any} size={18} color={colors.textSecondary} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.name}>{place.name}</Text>
          <Text style={styles.sub}>
            {place.region ?? '서울'}
            {open != null && <Text style={{ color: open ? colors.success : colors.textTertiary, fontWeight: '800' }}>{'  ·  '}{open ? '영업중' : '영업종료'}</Text>}
            {place.naver_rating ? <Text style={{ color: '#f5c451', fontWeight: '800' }}>{'  ·  ★ '}{place.naver_rating}</Text> : null}
          </Text>
          {tags.length > 0 && <View style={styles.tagWrap}>{tags.map((t) => <Text key={t} style={styles.tag}>#{t}</Text>)}</View>}
        </View>

        {/* 이 가게 인스타 — 게시물/릴스 썸네일, 탭하면 인스타로 (임베드는 추후) */}
        {media.length > 0 && (
          <View style={styles.igSection}>
            <View style={styles.igHead}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="logo-instagram" size={16} color={colors.textPrimary} />
                <Text style={styles.igTitle}>이 가게 인스타</Text>
              </View>
              {place.instagram && (
                <TouchableOpacity onPress={() => openOutlink(place.instagram!)}><Text style={styles.igAll}>전체 보기 ›</Text></TouchableOpacity>
              )}
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

        {/* 방문자 키워드(네이버·사실) */}
        {votes.length > 0 && (
          <View style={styles.revBox}>
            <Text style={styles.revTitle}>방문자 키워드</Text>
            <View style={styles.revChips}>
              {votes.map(([k, c]) => <View key={k} style={styles.revChip}><Text style={styles.revChipText}>{k} <Text style={styles.revCount}>{c}</Text></Text></View>)}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 하단 액션바 */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 8 }]}>
        <Act icon={isFav ? 'heart' : 'heart-outline'} label="저장" active={isFav} onPress={() => toggle(place.id)} styles={styles} colors={colors} />
        {place.tel && <Act icon="call-outline" label="전화" onPress={() => Linking.openURL(`tel:${place.tel}`)} styles={styles} colors={colors} />}
        <Act icon="navigate-outline" label="길찾기" onPress={() => openOutlink(mapUrl(place))} styles={styles} colors={colors} />
        {place.instagram && <Act icon="logo-instagram" label="인스타" onPress={() => openOutlink(place.instagram!)} styles={styles} colors={colors} />}
        {place.naver_url && (
          <TouchableOpacity style={styles.actPrimary} onPress={() => openOutlink(place.naver_url!)} activeOpacity={0.85}>
            <Text style={styles.actPrimaryText}>원본 ›</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

function mapUrl(p: PlaceRow): string {
  if (p.lat && p.lng) return `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}`
  return `https://map.kakao.com/?q=${encodeURIComponent(p.name)}`
}

function Act({ icon, label, active, onPress, styles, colors }: { icon: any; label: string; active?: boolean; onPress: () => void; styles: any; colors: AppColors }) {
  return (
    <TouchableOpacity style={styles.act} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={19} color={active ? colors.primary : colors.textSecondary} />
      <Text style={[styles.actLabel, active && { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    muted: { color: colors.textTertiary, fontSize: 14 },
    banner: { height: 96, alignItems: 'center', justifyContent: 'center' },
    body: { padding: 16, paddingBottom: 4 },
    titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
    catBadge: { backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 },
    catBadgeText: { fontSize: 12, fontWeight: '800', color: colors.primary },
    name: { fontSize: 21, fontWeight: '800', color: colors.textPrimary, marginBottom: 5 },
    sub: { fontSize: 13.5, color: colors.textSecondary, marginBottom: 10 },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tag: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    igSection: { paddingTop: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
    igHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
    igTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    igAll: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    igScroll: { paddingHorizontal: 16, gap: 8 },
    igItem: { position: 'relative' },
    igImg: { width: 132, height: 132, borderRadius: 12, backgroundColor: colors.surfaceHigh },
    igEmpty: { alignItems: 'center', justifyContent: 'center' },
    igReel: { position: 'absolute', top: 7, right: 7, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 3 },
    card: { margin: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider, paddingVertical: 6 },
    infoRow: { flexDirection: 'row', paddingVertical: 8, gap: 12 },
    infoK: { width: 44, color: colors.textTertiary, fontSize: 13, fontWeight: '700' },
    infoV: { flex: 1, color: colors.textPrimary, fontSize: 13.5, lineHeight: 21 },
    revBox: { marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
    revTitle: { fontSize: 12, fontWeight: '800', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
    revChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    revChip: { backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
    revChipText: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '600' },
    revCount: { color: colors.primary, fontWeight: '800' },
    actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 10, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
    act: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 4 },
    actLabel: { fontSize: 10.5, color: colors.textSecondary, fontWeight: '700' },
    actPrimary: { flex: 1, marginLeft: 4, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
    actPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  })
}
