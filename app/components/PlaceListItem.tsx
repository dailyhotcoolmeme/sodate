import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, openStatus, categoryCover, reviewHashtags } from '@/lib/places'

/**
 * 혼술바 피드 행. 썸네일=업체 인스타 프로필(원형 아바타). 하트는 소개팅과 동일(우상단·size20·#FF6B9D).
 * 제목 오른쪽에 지도 아이콘(탭→지도탭). 영업중 옆 오늘 영업시간(회색), 그 밑에 방문자 키워드 요약.
 */
interface Props {
  place: PlaceRow
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onTagPress?: (tag: string) => void
  onMapPress?: (place: PlaceRow) => void
}

const AV = 54

export default function PlaceListItem({ place, isFavorite = false, onToggleFavorite, onTagPress, onMapPress }: Props) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { open, hoursLabel } = openStatus(place.hours)
  const cover = categoryCover(place.category)
  const hashtags = reviewHashtags(place.keyword_votes)

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push(`/place/${place.id}`)}>
      {/* 하트 — 소개팅과 동일(우상단·size20·#FF6B9D) */}
      {onToggleFavorite && (
        <TouchableOpacity style={styles.heart} onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} activeOpacity={0.8} hitSlop={6}>
          <Ionicons name="heart" size={20} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
        </TouchableOpacity>
      )}

      {/* 원형 인스타 프로필 아바타 */}
      <View style={styles.avWrap}>
        {place.profile_image ? (
          <Image source={{ uri: place.profile_image }} style={styles.av} />
        ) : (
          <View style={[styles.av, styles.avFallback, { backgroundColor: cover.bg }]}><Ionicons name={cover.icon as any} size={24} color={cover.tint} /></View>
        )}
        {open != null && <View style={[styles.openDot, { backgroundColor: open ? colors.success : colors.textTertiary }]} />}
      </View>

      <View style={styles.info}>
        {/* 제목 + 오른쪽 지도 아이콘 */}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
          {onMapPress && place.lat && (
            <TouchableOpacity hitSlop={6} onPress={(e) => { e.stopPropagation?.(); onMapPress(place) }} style={styles.mapBtn}>
              <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* 방문자 키워드를 해시태그로 — 많으면 가로 스와이프(소개팅 해시태그와 동일 스펙) */}
        {hashtags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow} keyboardShouldPersistTaps="handled">
            {hashtags.map((t) => (
              <TouchableOpacity key={t} activeOpacity={0.6} onPress={(e) => { e.stopPropagation?.(); onTagPress?.(t) }}>
                <Text style={styles.tag}>#{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.metaRow}>
          {open != null && <Text style={[styles.op, { color: open ? colors.success : colors.textTertiary }]}>{open ? '영업중' : '영업종료'}</Text>}
          {hoursLabel && <Text style={styles.hours}>{'  '}{hoursLabel}</Text>}
          <Text style={styles.meta} numberOfLines={1}>{'  ·  '}{place.region ?? ''}{place.naver_rating ? `  ·  ★ ${place.naver_rating}` : ''}</Text>
        </View>
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginHorizontal: 16, marginVertical: 4, paddingVertical: 11, paddingHorizontal: 13, gap: 12 },
    heart: { position: 'absolute', top: 8, right: 10, zIndex: 2 },
    avWrap: { position: 'relative' },
    av: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.divider },
    avFallback: { alignItems: 'center', justifyContent: 'center' },
    openDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.surface },
    info: { flex: 1, gap: 3, paddingRight: 24 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    // 소개팅 제목과 동일: fontSize 14 · weight 700 · lineHeight 19
    name: { flexShrink: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 19 },
    mapBtn: { padding: 1 },
    // 소개팅 해시태그(sm)와 동일: height 17 · fontSize 11 · primary · weight 700
    tagScroll: { height: 17, flexGrow: 0, flexShrink: 0 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tag: { color: colors.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    op: { fontSize: 12, fontWeight: '800' },
    hours: { fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
  })
}
