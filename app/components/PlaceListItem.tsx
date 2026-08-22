import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, openStatus, categoryCover, socialLinks } from '@/lib/places'

/**
 * 혼술바 피드 행(2026-08-22 오너 승인). 썸네일 = 업체 인스타 프로필 이미지(작은 원형 아바타,
 * R2 재호스팅). 프로필 없으면 종류색 아이콘. 아바타가 작아 카드는 텍스트 중심으로 구성.
 * 사진·영상은 상세의 인스타 섹션에서.
 */
interface Props {
  place: PlaceRow
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onTagPress?: (tag: string) => void
}

const AV = 54

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
      {/* 원형 프로필 아바타 (인스타) */}
      <View style={styles.avWrap}>
        {place.profile_image ? (
          <Image source={{ uri: place.profile_image }} style={styles.av} />
        ) : (
          <View style={[styles.av, { backgroundColor: cover.bg, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name={cover.icon as any} size={24} color={cover.tint} />
          </View>
        )}
        {open != null && <View style={[styles.openDot, { backgroundColor: open ? colors.success : colors.textTertiary }]} />}
      </View>

      <View style={styles.info}>
        <View style={styles.topline}>
          {place.category && <View style={styles.catBadge}><Text style={styles.catBadgeText}>{place.category}</Text></View>}
          <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
        </View>
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
          <Text style={styles.meta} numberOfLines={1}>
            {open != null ? '  ·  ' : ''}{place.region ?? '서울'}{place.naver_rating ? `  ·  ★ ${place.naver_rating}` : ''}
          </Text>
          {socials.map((s) => (
            <TouchableOpacity key={s.key} hitSlop={6} onPress={(e) => { e.stopPropagation?.(); Linking.openURL(s.url) }}>
              <Ionicons name={s.icon as any} size={15} color={colors.textTertiary} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ))}
        </View>
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
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginHorizontal: 16, marginVertical: 4, paddingVertical: 11, paddingHorizontal: 13, gap: 12 },
    avWrap: { position: 'relative' },
    av: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.divider },
    openDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.surface },
    info: { flex: 1, gap: 3 },
    topline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    catBadge: { backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
    catBadgeText: { fontSize: 10.5, fontWeight: '800', color: colors.primary },
    name: { flex: 1, fontSize: 15.5, color: colors.textPrimary, fontWeight: '800' },
    tagScroll: { height: 16, flexGrow: 0, flexShrink: 0 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tag: { color: colors.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    op: { fontSize: 12, fontWeight: '800' },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
    heart: { paddingLeft: 4 },
  })
}
