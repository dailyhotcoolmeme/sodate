import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, openStatus, categoryCover, socialLinks } from '@/lib/places'

/**
 * 혼술바 피드 행. 썸네일=업체 인스타 프로필(원형 아바타). 하트는 소개팅처럼 우측 상단.
 * 영업중 옆에 '오늘(문 여는 요일)' 영업시간을 회색으로. 소셜 아이콘 전부 + 지도 아이콘.
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
  const socials = socialLinks(place)
  const tags = [...place.honsul_badges, ...place.mood_tags]

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push(`/place/${place.id}`)}>
      {/* 하트 — 우측 상단(소개팅과 동일) */}
      {onToggleFavorite && (
        <TouchableOpacity style={styles.heart} onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} activeOpacity={0.8} hitSlop={6}>
          <Ionicons name="heart" size={18} color={isFavorite ? colors.primary : colors.textTertiary} />
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
        <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
        {tags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow} keyboardShouldPersistTaps="handled">
            {tags.map((t) => (
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
        <View style={styles.iconRow}>
          {socials.map((s) => (
            <TouchableOpacity key={s.key} hitSlop={5} onPress={(e) => { e.stopPropagation?.(); Linking.openURL(s.url) }}>
              <Ionicons name={s.icon as any} size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
          {onMapPress && place.lat && (
            <TouchableOpacity hitSlop={5} onPress={(e) => { e.stopPropagation?.(); onMapPress(place) }}>
              <Ionicons name="location-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginHorizontal: 16, marginVertical: 4, paddingVertical: 11, paddingHorizontal: 13, gap: 12 },
    heart: { position: 'absolute', top: 10, right: 10, zIndex: 2 },
    avWrap: { position: 'relative' },
    av: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.divider },
    avFallback: { alignItems: 'center', justifyContent: 'center' },
    openDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.surface },
    info: { flex: 1, gap: 3, paddingRight: 22 },
    name: { fontSize: 15.5, color: colors.textPrimary, fontWeight: '800' },
    tagScroll: { height: 16, flexGrow: 0, flexShrink: 0 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tag: { color: colors.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    op: { fontSize: 12, fontWeight: '800' },
    hours: { fontSize: 12, color: colors.textTertiary, fontWeight: '600' },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
    iconRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  })
}
