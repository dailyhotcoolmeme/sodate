import React, { useMemo } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { openStatus, reviewHashtags, type PlaceRow } from '@/lib/places'

// compact 카드 최대 가로폭 — 고정폭이 아니라 상한선이다(2026-08-24 오너 지시: "이름 길이에
// 맞게 자동으로 줄어들게, 넘으면 줄바꿈"). 실제 폭은 이름 길이에 따라 이보다 좁을 수 있다.
// B안(오너 승인, 시안 3종 중 240 선택) — anchor 중앙정렬 계산은 이 값을 상한 기준으로 쓴다.
const COMPACT_MAX_W = 240
// 카드 높이 추정치(패딩+사진) — anchor 기준 위/아래 뒤집을지 판단용. 실측은 아니고 대략치.
const COMPACT_H_EST = 84

/** 지도에서 마커 탭 시 뜨는 매장 정보카드(혼술맵 참고, 우리 스타일).
 *  compact — 상세페이지 히어로(200px 높이)처럼 지도 자체가 작은 곳에 쓸 때(2026-08-24
 *  오너 지적: "히어로 지도 전체 사이즈 비율 고려해서 맞춰야 할 거 아니야"). 전체화면
 *  지도탭(honsul/index.tsx)은 기본(큰) 크기 그대로 쓴다.
 *  anchor — 탭한 마커의 화면 좌표. 있으면 그 점 바로 아래(넘치면 위)에 띄운다(2026-08-24
 *  오너 지적: "업체박스 왜 왼쪽 밑에 고정이냐, 누른 점 바로 밑에 떠야지"). 없으면(좌표를
 *  못 구했을 때) 예전처럼 좌하단 고정. */
export default function PlaceMapCard({
  place, isFavorite, onToggleFavorite, onOpen, onClose, compact = false, anchor = null, containerWidth, containerHeight,
}: {
  place: PlaceRow
  isFavorite: boolean
  onToggleFavorite: () => void
  onOpen: () => void
  onClose: () => void
  compact?: boolean
  anchor?: { x: number; y: number } | null
  containerWidth?: number
  containerHeight?: number
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors, compact), [colors, compact])
  const { open, hoursLabel } = openStatus(place.hours)
  const tag = reviewHashtags(place.keyword_votes, 1)[0]

  const wrapStyle = useMemo(() => {
    if (!compact || !anchor || !containerWidth) return styles.wrap
    const cw = containerWidth
    const ch = containerHeight ?? 9999
    const left = Math.min(Math.max(anchor.x - COMPACT_MAX_W / 2, 8), Math.max(8, cw - COMPACT_MAX_W - 8))
    const spaceBelow = ch - anchor.y
    const top = spaceBelow >= COMPACT_H_EST + 14
      ? anchor.y + 14
      : Math.max(8, anchor.y - COMPACT_H_EST - 14)
    return [styles.wrap, { left, top, bottom: undefined }]
  }, [compact, anchor, containerWidth, containerHeight, styles.wrap])

  return (
    <View style={wrapStyle}>
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={onOpen}>
        <Image source={{ uri: place.profile_image ?? place.thumbnail_url ?? undefined }} style={styles.photo} contentFit="cover" />
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={compact ? 2 : 1}>{place.name}</Text>
            {/* compact(히어로 지도 미리보기)에선 즐겨찾기 뺀다 — 안 그래도 좁은데 더 좁아진다
                (2026-08-24 오너 지적). 상세로 들어가면 거기서 찜하면 된다. */}
            {!compact && (
              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} hitSlop={8}>
                <Ionicons name="bookmark" size={22} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
              </TouchableOpacity>
            )}
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
    // compact 기본값(anchor 없을 때 폴백) — 좌하단 고정.
    wrap: compact ? { position: 'absolute', left: 8, bottom: 8 } : { position: 'absolute', left: 12, right: 12, bottom: 14 },
    card: {
      flexDirection: 'row', gap: compact ? 8 : 12, backgroundColor: colors.surface, borderRadius: compact ? 12 : 16, padding: compact ? 8 : 12,
      shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: compact ? 8 : 14, shadowOffset: { width: 0, height: compact ? 3 : 6 }, elevation: compact ? 5 : 8,
      // 고정폭이 아니라 상한선(오너 지시: 이름 짧으면 그만큼만, 상한 넘으면 줄바꿈).
      ...(compact ? { maxWidth: COMPACT_MAX_W } : null),
    },
    photo: { width: compact ? 52 : 92, height: compact ? 52 : 92, borderRadius: compact ? 8 : 12, backgroundColor: colors.surfaceHigh },
    info: compact
      ? { flexShrink: 1, minWidth: 0, gap: 1, justifyContent: 'center' }
      : { flex: 1, minWidth: 0, gap: 3, justifyContent: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: compact ? 6 : 8 },
    name: { flex: 1, fontSize: compact ? 13.5 : 16, fontWeight: '800', color: colors.textPrimary },
    meta: { fontSize: compact ? 11 : 12.5, color: colors.textTertiary },
    detailBtn: { marginTop: 5, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7 },
    detailText: { fontSize: 13, fontWeight: '800', color: '#fff' },
    close: { position: 'absolute', top: compact ? 5 : 8, right: compact ? 5 : 8, padding: 2 },
  })
}
