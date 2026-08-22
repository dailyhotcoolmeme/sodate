import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, cleanImageUrl, openStatus } from '@/lib/places'

/**
 * 혼술바 피드 행. 소셜링 카드와 같은 틀이되, 이벤트가 아니라 '매장'이라 셋이 다르다:
 *   1. 일시/D-day 대신 영업상태(영업중/영업종료) + 영업시간.
 *   2. 제목 위 종류 배지 + 그 아래 ★혼술 친화 배지(앰버) — 차별화 축.
 *   3. 참여현황 대신 지역 + 평점(있으면).
 */
interface Props {
  place: PlaceRow
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onTagPress?: (tag: string) => void
}

const AMBER = '#E0A13C'
const THUMB = 88

export default function PlaceListItem({ place, isFavorite = false, onToggleFavorite, onTagPress }: Props) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const img = cleanImageUrl(place.thumbnail_url)
  const { open } = openStatus(place.hours)

  // (파일럿) 상세 화면 전이라 탭하면 네이버 원본으로. 상세 만들면 router.push('/place/'+id)로 교체.
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => place.naver_url && openOutlink(place.naver_url)}>
      {/* 썸네일 + 영업상태 */}
      <View style={styles.thumbWrap}>
        {img ? (
          <Image source={{ uri: img }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="wine-outline" size={26} color={colors.textTertiary} /></View>
        )}
        {open != null && (
          <View style={[styles.openPill, open ? styles.openOn : styles.openOff]}>
            <Text style={styles.openText}>{open ? '영업중' : '영업종료'}</Text>
          </View>
        )}
      </View>

      {/* 종류 배지 → 이름 → 혼술 배지 → 지역·영업시간 */}
      <View style={styles.info}>
        {place.category && (
          <View style={styles.catBadge}><Text style={styles.catBadgeText}>{place.category}</Text></View>
        )}
        <Text style={styles.name} numberOfLines={1}>{place.name}</Text>

        {(place.honsul_badges.length > 0 || place.mood_tags.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagScroll} contentContainerStyle={styles.tagRow} keyboardShouldPersistTaps="handled">
            {[...place.honsul_badges, ...place.mood_tags].map((t) => (
              <TouchableOpacity key={t} activeOpacity={0.6} onPress={(e) => { e.stopPropagation?.(); onTagPress?.(t) }}>
                <Text style={styles.tag}>#{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <Text style={styles.meta} numberOfLines={1}>
          {place.region ?? '서울'}
          {place.naver_rating ? `  ·  ★ ${place.naver_rating}` : ''}
          {place.hours ? `  ·  ${todayHours(place.hours)}` : ''}
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

const DOW = ['일', '월', '화', '수', '목', '금', '토']
function todayHours(hours: Record<string, string>): string {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const h = hours[DOW[kst.getDay()]]
  return h ? h.replace('~', '–') : '영업시간 정보'
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface,
      borderRadius: 12, marginHorizontal: 16, marginVertical: 5, padding: 12, gap: 12,
    },
    thumbWrap: { position: 'relative', width: THUMB },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    openPill: { position: 'absolute', left: 4, top: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    openOn: { backgroundColor: 'rgba(55,201,139,0.92)' },
    openOff: { backgroundColor: 'rgba(24,24,27,0.72)' },
    openText: { fontSize: 10, color: '#fff', fontWeight: '800' },
    info: { flex: 1, gap: 3, alignSelf: 'flex-start' },
    catBadge: { alignSelf: 'flex-start', backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    catBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
    name: { fontSize: 15, color: colors.textPrimary, fontWeight: '800', lineHeight: 20 },
    // 혼술친화·조용·심야·무드 = 해시태그(오너 지시). 소개팅 해시태그와 같은 톤(primary).
    tagScroll: { height: 17, flexGrow: 0, flexShrink: 0 },
    tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tag: { color: colors.primary, fontSize: 11, fontWeight: '700', lineHeight: 15 },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    heart: { paddingLeft: 4, paddingTop: 2 },
  })
}
