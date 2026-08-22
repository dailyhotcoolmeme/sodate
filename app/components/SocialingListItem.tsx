import React, { useMemo } from 'react'
import EventThumbnail from './EventThumbnail'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import HashtagChips from './HashtagChips'
import { daysUntil } from '@/lib/dday'
import { groupForCategory } from '@/constants/socialingCategories'

/**
 * 소셜링 피드 행(2026-08-21, 오너 승인). 소개팅 EventListItem 과 같은 틀이되 딱 세 가지만 다르다:
 *   1. 카테고리 배지를 제목 위 별도 줄에(독서·영화·등산 등을 한눈에). 소개팅은 배지 없음.
 *   2. 썸네일 아래 업체명(플랫폼) 숨김 — 오너 방향("모임" 중심, 로고 전면에 안 박기).
 *   3. 남/여 가격·나이 2행 자리 → 참여현황(있는 것만: 성비 / 총정원 / 대기).
 * 나머지(썸네일·D-day·제목·해시태그·날짜·지역·하트·마감처리)는 EventListItem 그대로.
 */
interface Props {
  event: EventWithCompany
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

function cleanTitle(title: string): string {
  return title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|‍/gu, '')
    .replace(/_E\d+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const THUMB = 88

export default function SocialingListItem({ event, isFavorite = false, onToggleFavorite }: Props) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const daysLeft = daysUntil(event.event_date)
  const group = groupForCategory(event.socialing_category)

  // 참여현황 — 있는 것만. 성비(문토) > 총정원(동행) > 대기(트레바리).
  const stats = event.participant_stats
  const mc = stats?.male_count
  const fc = stats?.female_count
  const cap = stats?.total_capacity
  const cur = stats?.total_count

  const handlePress = () => {
    // 소셜링도 소개팅과 같은 방식 — 눌러서 상세로. 아직 상세가 없으면 아웃링크로 바로.
    router.push(`/event/${event.id}`)
  }

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handlePress}>
      {/* 왼쪽: 썸네일 (업체명은 숨김) */}
      <View style={styles.leftCol}>
        <View style={styles.thumbWrap}>
          <EventThumbnail
            url={event.thumbnail_urls?.[0]}
            companyName={event.companies?.name}
            region={event.location_region}
            style={styles.thumb}
          />
          {daysLeft <= 3 && daysLeft >= 0 && (
            <View style={styles.deadlineDot}>
              <Text style={styles.deadlineText}>{daysLeft === 0 ? '오늘' : `D-${daysLeft}`}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 오른쪽: 카테고리 배지 → 제목 → 해시태그 → 날짜·지역 → 참여현황 */}
      <View style={styles.info}>
        {group && (
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{group.label}</Text>
          </View>
        )}
        <Text style={styles.title} numberOfLines={2}>{cleanTitle(event.title)}</Text>
        <HashtagChips hashtags={event.hashtags} size="sm" tight />
        <Text style={styles.meta}>{formatDate(event.event_date)} · {event.location_region}</Text>

        <View style={styles.partBlock}>
          {(mc != null || fc != null) ? (
            <View style={styles.partRow}>
              {mc != null && <Text style={[styles.gtag, styles.gMale]}>남 {mc}</Text>}
              {fc != null && <Text style={[styles.gtag, styles.gFemale]}>여 {fc}</Text>}
            </View>
          ) : cap != null ? (
            <View style={styles.partRow}>
              <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
              <Text style={styles.partText}>정원 {cap}명 중 <Text style={styles.partHi}>{cur ?? 0}명</Text> 참여</Text>
            </View>
          ) : (
            <Text style={styles.partMuted}>신청 · 대기 가능</Text>
          )}
        </View>
      </View>

      {/* 하트 */}
      {onToggleFavorite && (
        <TouchableOpacity
          style={styles.heart}
          onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
          activeOpacity={0.8}
        >
          <Ionicons name="heart" size={18} color={isFavorite ? colors.primary : colors.textTertiary} />
        </TouchableOpacity>
      )}

      {/* 마감 오버레이 — 소개팅과 동일 */}
      {event.is_closed && (
        <View style={styles.closedOverlay} pointerEvents="none">
          <View style={styles.closedBadge}>
            <Text style={styles.closedBadgeText}>마감</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface,
      borderRadius: 12, marginHorizontal: 16, marginVertical: 5, padding: 12, gap: 12, overflow: 'hidden',
    },
    leftCol: { alignItems: 'center', width: THUMB },
    thumbWrap: { position: 'relative' },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10 },
    deadlineDot: { position: 'absolute', top: 4, left: 4, backgroundColor: colors.deadline, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
    deadlineText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    info: { flex: 1, gap: 2, alignSelf: 'flex-start' },
    // 카테고리 배지 — 제목 위 별도 줄. primary 계열 톤으로 눈에 띄되 과하지 않게.
    catBadge: { alignSelf: 'flex-start', backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 2 },
    catBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
    title: { fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 19 },
    meta: { fontSize: 12, color: colors.textSecondary },
    partBlock: { marginTop: 3, minHeight: 20, justifyContent: 'center' },
    partRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    gtag: { fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
    gMale: { color: '#7fb3e0', backgroundColor: 'rgba(91,155,213,0.16)' },
    gFemale: { color: colors.primary, backgroundColor: `${colors.primary}1f` },
    partText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
    partHi: { color: colors.success, fontWeight: '800' },
    partMuted: { fontSize: 12, color: colors.textTertiary },
    heart: { paddingLeft: 4, paddingTop: 2 },
    closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
    closedBadge: { backgroundColor: 'rgba(24,24,27,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10 },
    closedBadgeText: { color: '#fff', fontSize: 12.5, fontWeight: '700', letterSpacing: 1 },
  })
}
