import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, openStatus, categoryCover, socialLinks } from '@/lib/places'

/**
 * 혼술바 피드 행(안 C, 2026-08-22 오너 승인). 사진 없이 종류색 아이콘 커버로 시각 리듬.
 *   좌: 종류색 배경 + 이모지 커버 / 우: 종류배지·이름·해시태그·영업상태/지역/평점·소셜아이콘.
 * 사진·영상은 상세의 인스타 섹션에서(재호스팅 안 함).
 */
interface Props {
  place: PlaceRow
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onTagPress?: (tag: string) => void
}

const THUMB = 74

export default function PlaceListItem({ place, isFavorite = false, onToggleFavorite, onTagPress }: Props) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { open } = openStatus(place.hours)
  const cover = categoryCover(place.category)
  const socials = socialLinks(place)
  const tags = [...place.honsul_badges, ...place.mood_tags]

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push(`/place/${place.id}`)}>
      <View style={[styles.cover, { backgroundColor: cover.bg }]}>
        <Ionicons name={cover.icon as any} size={30} color={cover.tint} />
        {open != null && <View style={[styles.openDot, { backgroundColor: open ? colors.success : colors.textTertiary }]} />}
      </View>

      <View style={styles.info}>
        <View style={styles.topline}>
          {place.category && <View style={styles.catBadge}><Text style={styles.catBadgeText}>{place.category}</Text></View>}
          {socials.map((s) => (
            <TouchableOpacity key={s.key} hitSlop={6} onPress={(e) => { e.stopPropagation?.(); Linking.openURL(s.url) }}>
              <Ionicons name={s.icon as any} size={15} color={colors.textTertiary} style={{ marginLeft: 5 }} />
            </TouchableOpacity>
          ))}
        </View>
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
        <Text style={styles.meta} numberOfLines={1}>
          {open != null && <Text style={{ color: open ? colors.success : colors.textTertiary, fontWeight: '800' }}>{open ? '영업중' : '영업종료'}{'  ·  '}</Text>}
          {place.region ?? '서울'}
          {place.naver_rating ? `  ·  ★ ${place.naver_rating}` : ''}
        </Text>
      </View>

      {onToggleFavorite && (
        <TouchableOpacity style={styles.heart} onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} activeOpacity={0.8}>
          <Ionicons name="heart" size={18} color={isFavorite ? colors.primary : colors.textTertiary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderRadius: 12, marginHorizontal: 16, marginVertical: 5, padding: 11, gap: 12 },
    cover: { width: THUMB, height: THUMB, borderRadius: 12, alignItems: 'center', justifyContent: 'center', position: 'relative' },
    openDot: { position: 'absolute', top: 7, right: 7, width: 8, height: 8, borderRadius: 4 },
    info: { flex: 1, gap: 3, alignSelf: 'flex-start' },
    topline: { flexDirection: 'row', alignItems: 'center' },
    catBadge: { backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    catBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
    name: { fontSize: 15.5, color: colors.textPrimary, fontWeight: '800', lineHeight: 21 },
    tagScroll: { height: 17, flexGrow: 0, flexShrink: 0 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tag: { color: colors.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    heart: { paddingLeft: 4, paddingTop: 2 },
  })
}
