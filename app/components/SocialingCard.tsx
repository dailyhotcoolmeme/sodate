import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import EventThumbnail from './EventThumbnail'
import DeadlineBadge from './DeadlineBadge'
import HashtagChips from './HashtagChips'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import { daysUntil } from '@/lib/dday'
import { groupForCategory } from '@/constants/socialingCategories'

/**
 * 소셜링 카드형(2026-08-21). 소개팅 EventCard 와 같은 세로 카드 틀이되 세 가지만 다르다:
 *   1. 카테고리 배지를 제목 위 별도 줄에. 2. 업체명(플랫폼) 숨김. 3. 남/여 2행 → 참여현황.
 * 목록형은 SocialingListItem, 카드형은 이 컴포넌트 — 소개팅의 EventListItem/EventCard 짝과 동일 구조.
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

export default function SocialingCard({ event, isFavorite = false, onToggleFavorite }: Props) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const daysLeft = daysUntil(event.event_date)
  const group = groupForCategory(event.socialing_category)
  const stats = event.participant_stats
  const mc = stats?.male_count
  const fc = stats?.female_count
  const cap = stats?.total_capacity
  const cur = stats?.total_count

  return (
    <TouchableOpacity style={styles.card} onPress={() => router.push(`/event/${event.id}`)} activeOpacity={0.85}>
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        <EventThumbnail
          url={event.thumbnail_urls?.[0]}
          companyName={event.companies?.name}
          region={event.location_region}
          style={styles.image}
          size="large"
        />
        {daysLeft <= 3 && daysLeft >= 0 && <DeadlineBadge daysLeft={daysLeft} />}
        {onToggleFavorite && (
          <TouchableOpacity
            style={[styles.heartBtn, isFavorite && styles.heartBtnActive]}
            onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
            activeOpacity={0.8}
          >
            <Ionicons name="heart" size={18} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 내용 (업체명 숨김) */}
      <View style={styles.content}>
        {group && (
          <View style={styles.catBadge}><Text style={styles.catBadgeText}>{group.label}</Text></View>
        )}
        <Text style={styles.title} numberOfLines={2}>{cleanTitle(event.title)}</Text>
        <HashtagChips hashtags={event.hashtags} size="sm" />
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatDate(event.event_date)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{event.location_region}</Text>
        </View>

        {/* 참여현황 — 성비(문토) > 총정원(동행) > 대기(트레바리) */}
        <View style={styles.partBlock}>
          {(mc != null || fc != null) ? (
            <View style={styles.partRow}>
              {mc != null && <Text style={[styles.gtag, styles.gMale]}>남 {mc}</Text>}
              {fc != null && <Text style={[styles.gtag, styles.gFemale]}>여 {fc}</Text>}
            </View>
          ) : cap != null ? (
            <View style={styles.partRow}>
              <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.partText}>정원 {cap}명 중 <Text style={styles.partHi}>{cur ?? 0}명</Text> 참여</Text>
            </View>
          ) : (
            <Text style={styles.partMuted}>신청 · 대기 가능</Text>
          )}
        </View>

        {/* 신청 */}
        <View style={styles.ctaRow}>
          <TouchableOpacity style={[styles.cta, event.is_closed && styles.ctaClosed]} onPress={() => openOutlink(event.source_url)}>
            <Text style={event.is_closed ? styles.ctaClosedText : styles.ctaText}>
              {event.is_closed ? '신청 마감' : '신청하기  ›'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {event.is_closed && (
        <View style={styles.closedOverlay} pointerEvents="none">
          <View style={styles.closedBadge}><Text style={styles.closedBadgeText}>마감</Text></View>
        </View>
      )}
    </TouchableOpacity>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      marginHorizontal: 16, marginVertical: 8, overflow: 'hidden',
    },
    imageContainer: { position: 'relative' },
    image: { width: '100%', height: 200 },
    heartBtn: {
      position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18,
      borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    heartBtnActive: { borderColor: '#FF6B9D', backgroundColor: '#FF6B9D18' },
    content: { padding: 16, gap: 4 },
    catBadge: { alignSelf: 'flex-start', backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    catBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },
    title: { fontSize: 16, color: colors.textPrimary, fontWeight: '700', lineHeight: 21 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    meta: { fontSize: 13, color: colors.textSecondary },
    metaDot: { fontSize: 13, color: colors.textTertiary, marginHorizontal: 5 },
    partBlock: { marginTop: 2, minHeight: 22, justifyContent: 'center' },
    partRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    gtag: { fontSize: 12, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
    gMale: { color: '#7fb3e0', backgroundColor: 'rgba(91,155,213,0.16)' },
    gFemale: { color: colors.primary, backgroundColor: `${colors.primary}1f` },
    partText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    partHi: { color: colors.success, fontWeight: '800' },
    partMuted: { fontSize: 13, color: colors.textTertiary },
    ctaRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    cta: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
    ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    ctaClosed: { backgroundColor: '#e5e7eb' },
    ctaClosedText: { color: '#9ca3af', fontWeight: '700', fontSize: 14 },
    closedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
    closedBadge: { backgroundColor: 'rgba(24,24,27,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 12 },
    closedBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  })
}
