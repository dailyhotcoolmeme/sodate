import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { openStatus, reviewHashtags, type PlaceRow } from '@/lib/places'

/** 지도에서 마커 탭 시 하단에 뜨는 매장 정보카드(혼술맵 참고, 우리 스타일).
 *  compact — 상세페이지 히어로(200px 높이)처럼 지도 자체가 작은 곳에 쓸 때(2026-08-24
 *  오너 지적: "히어로 지도 전체 사이즈 비율 고려해서 맞춰야 할 거 아니야"). 전체화면
 *  지도탭(honsul/index.tsx)은 기본(큰) 크기 그대로 쓴다. */
export default function PlaceMapCard({
  place, isFavorite, onToggleFavorite, onOpen, onClose, compact = false,
}: {
  place: PlaceRow
  isFavorite: boolean
  onToggleFavorite: () => void
  onOpen: () => void
  onClose: () => void
  compact?: boolean
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors, compact), [colors, compact])
  const { open, hoursLabel } = openStatus(place.hours)
  const tag = reviewHashtags(place.keyword_votes, 1)[0]

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={onOpen}>
        <Image source={{ uri: place.profile_image ?? place.thumbnail_url ?? undefined }} style={styles.photo} contentFit="cover" />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
            <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} hitSlop={8}>
              <Ionicons name="bookmark" size={compact ? 17 : 22} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
            </TouchableOpacity>
          </View>
          {!compact && open != null && (
            <Text style={styles.meta}>
              <Text style={{ color: open ? colors.success : colors.textTertiary, fontWeight: '700' }}>{open ? '영업중' : '영업종료'}</Text>
              {hoursLabel ? `  ${hoursLabel}` : ''}
            </Text>
          )}
          <Text style={styles.meta} numberOfLines={1}>
            {compact && open != null ? `${open ? '영업중' : '영업종료'}  ·  ` : ''}
            {place.naver_rating ? `★ ${place.naver_rating}  ·  ` : ''}{place.region ?? ''}{!compact && tag ? `  ·  #${tag}` : ''}
          </Text>
          {!compact && (
            <TouchableOpacity style={styles.detailBtn} onPress={onOpen} activeOpacity={0.85}>
              <Text style={styles.detailText}>상세보기</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.close} onPress={(e) => { e.stopPropagation?.(); onClose() }} hitSlop={8}>
          <Ionicons name="close" size={compact ? 15 : 18} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(colors: AppColors, compact: boolean) {
  return StyleSheet.create({
    wrap: compact ? { position: 'absolute', left: 8, right: 8, bottom: 8 } : { position: 'absolute', left: 12, right: 12, bottom: 14 },
    card: {
      flexDirection: 'row', gap: compact ? 8 : 12, backgroundColor: colors.surface, borderRadius: compact ? 12 : 16, padding: compact ? 8 : 12,
      shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: compact ? 8 : 14, shadowOffset: { width: 0, height: compact ? 3 : 6 }, elevation: compact ? 5 : 8,
    },
    photo: { width: compact ? 52 : 92, height: compact ? 52 : 92, borderRadius: compact ? 8 : 12, backgroundColor: colors.surfaceHigh },
    info: { flex: 1, minWidth: 0, gap: compact ? 1 : 3, justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 8 },
    name: { flex: 1, fontSize: compact ? 13.5 : 16, fontWeight: '800', color: colors.textPrimary },
    meta: { fontSize: compact ? 11 : 12.5, color: colors.textTertiary },
    detailBtn: { marginTop: 5, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7 },
    detailText: { fontSize: 13, fontWeight: '800', color: '#fff' },
    close: { position: 'absolute', top: compact ? 5 : 8, right: compact ? 5 : 8, padding: 2 },
  })
}
