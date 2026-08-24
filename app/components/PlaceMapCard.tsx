import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { openStatus, reviewHashtags, type PlaceRow } from '@/lib/places'

/** 지도에서 마커 탭 시 하단에 뜨는 매장 정보카드(혼술맵 참고, 우리 스타일). */
export default function PlaceMapCard({
  place, isFavorite, onToggleFavorite, onOpen, onClose,
}: {
  place: PlaceRow
  isFavorite: boolean
  onToggleFavorite: () => void
  onOpen: () => void
  onClose: () => void
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
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
              <Ionicons name="bookmark" size={22} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
            </TouchableOpacity>
          </View>
          {open != null && (
            <Text style={styles.meta}>
              <Text style={{ color: open ? colors.success : colors.textTertiary, fontWeight: '700' }}>{open ? '영업중' : '영업종료'}</Text>
              {hoursLabel ? `  ${hoursLabel}` : ''}
            </Text>
          )}
          <Text style={styles.meta} numberOfLines={1}>
            {place.naver_rating ? `★ ${place.naver_rating}  ·  ` : ''}{place.region ?? ''}{tag ? `  ·  #${tag}` : ''}
          </Text>
          <TouchableOpacity style={styles.detailBtn} onPress={onOpen} activeOpacity={0.85}>
            <Text style={styles.detailText}>상세보기</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.close} onPress={(e) => { e.stopPropagation?.(); onClose() }} hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { position: 'absolute', left: 12, right: 12, bottom: 14 },
    card: {
      flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 12,
      shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    },
    photo: { width: 92, height: 92, borderRadius: 12, backgroundColor: colors.surfaceHigh },
    info: { flex: 1, minWidth: 0, gap: 3 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    meta: { fontSize: 12.5, color: colors.textTertiary },
    detailBtn: { marginTop: 5, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7 },
    detailText: { fontSize: 13, fontWeight: '800', color: '#fff' },
    close: { position: 'absolute', top: 8, right: 8, padding: 2 },
  })
}
