import React, { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import type { ParticipantStats } from '@/types/database.types'
import DeadlineBadge from './DeadlineBadge'
import ParticipantStatsSheet from './ParticipantStatsSheet'
import { daysUntil } from '@/lib/dday'

interface Props {
  event: EventWithCompany
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

// 렌더링 깨지는 이모지/특수문자 제거 (Hermes 호환)
function cleanTitle(title: string): string {
  return title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/_E\d+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const COMPANY_COLORS: Record<string, string> = {
  '모드파티': '#6C3CE1',
  '연인어때': '#E84393',
  '러브캐스팅': '#E85D04',
  '에모셔널오렌지': '#F4842B',
  '프립': '#00B4D8',
  '문토': '#2D6A4F',
  '토크블라썸': '#F72585',
}
function hasParticipantData(stats: any): boolean {
  if (!stats) return false
  return (stats.male?.length > 0) || (stats.female?.length > 0) || stats.total_count !== undefined
}

function companyColor(name?: string): string {
  if (name && COMPANY_COLORS[name]) return COMPANY_COLORS[name]
  return '#3A3A3A'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const THUMB = 88

export default function EventListItem({ event, isFavorite = false, onToggleFavorite }: Props) {
  const router = useRouter()
  const colors = useColors()
  const seatColor = (n: number | null) => {
    if (n == null) return undefined
    if (n <= 1) return colors.error
    if (n <= 3) return colors.warning
    return colors.textPrimary
  }
  const [statsVisible, setStatsVisible] = useState(false)
  const styles = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginHorizontal: 16,
      marginVertical: 5,
      padding: 12,
      gap: 12,
    },
    thumbWrap: { position: 'relative' },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10 },
    thumbPlaceholder: {
      width: THUMB,
      height: THUMB,
      borderRadius: 10,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbInitial: { fontSize: 26, color: '#fff', fontWeight: '800' },
    deadlineDot: {
      position: 'absolute',
      bottom: 4,
      left: 4,
      backgroundColor: colors.deadline,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    deadlineText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    info: { flex: 1, gap: 3 },
    company: { fontSize: 11, color: colors.primary, fontWeight: '600' },
    title: { fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 20 },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    price: { fontSize: 12, color: colors.textSecondary },
    seatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    seatsLabel: { fontSize: 12, color: colors.textSecondary, marginRight: 6 },
    seatsText: { fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
    ageText: { fontSize: 11, color: '#9B59F5', fontWeight: '600' },
    heart: { paddingLeft: 4, paddingTop: 2 },
    heartIcon: { fontSize: 18, color: colors.textTertiary },
    heartActive: { color: colors.primary },
    rightCol: { alignItems: 'center', gap: 6 },
    statsSmallBtn: {
      borderWidth: 1,
      borderColor: '#9B59F5',
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    statsSmallBtnText: { fontSize: 10, color: '#9B59F5' },
  }), [colors])

  const daysLeft = daysUntil(event.event_date)

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/event/${event.id}`)}
      activeOpacity={0.82}
    >
      {/* 썸네일 */}
      <View style={styles.thumbWrap}>
        {event.thumbnail_urls?.[0] ? (
          <Image source={{ uri: event.thumbnail_urls[0] }} style={styles.thumb} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.thumbPlaceholder, { backgroundColor: companyColor(event.companies?.name) }]}>
            <Text style={styles.thumbInitial}>{event.companies?.name?.[0] ?? '소'}</Text>
          </View>
        )}
        {daysLeft <= 3 && daysLeft >= 0 && (
          <View style={styles.deadlineDot}>
            <Text style={styles.deadlineText}>{daysLeft === 0 ? '오늘' : `D-${daysLeft}`}</Text>
          </View>
        )}
      </View>

      {/* 내용 */}
      <View style={styles.info}>
        {event.companies && (
          <Text style={styles.company}>{event.companies.name}</Text>
        )}
        <Text style={styles.title} numberOfLines={2}>{cleanTitle(event.title)}</Text>
        <Text style={styles.meta}>{formatDate(event.event_date)} · {event.location_region}</Text>
        <View style={styles.seatsRow}>
          <Text style={styles.seatsLabel}>정원</Text>
          {(event.capacity_male != null || event.capacity_female != null) ? (
            <Text style={styles.seatsText}>
              {[
                event.capacity_male != null ? `남 ${event.capacity_male}명` : null,
                event.capacity_female != null ? `여 ${event.capacity_female}명` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          ) : (
            <Text style={styles.seatsText}>-</Text>
          )}
        </View>
        <View style={styles.seatsRow}>
          <Text style={styles.seatsLabel}>잔여석</Text>
          {(event.seats_left_male != null || event.seats_left_female != null) ? (
            <Text style={styles.seatsText}>
              {event.seats_left_male != null && (
                <Text style={{ color: seatColor(event.seats_left_male) }}>
                  {event.seats_left_male === 0 ? '남 마감' : `남 ${event.seats_left_male}석`}
                </Text>
              )}
              {event.seats_left_male != null && event.seats_left_female != null ? ' · ' : ''}
              {event.seats_left_female != null && (
                <Text style={{ color: seatColor(event.seats_left_female) }}>
                  {event.seats_left_female === 0 ? '여 마감' : `여 ${event.seats_left_female}석`}
                </Text>
              )}
            </Text>
          ) : (
            <Text style={styles.seatsText}>-</Text>
          )}
        </View>
        <View style={styles.seatsRow}>
          <Text style={styles.seatsLabel}>참가비</Text>
          {(event.price_male != null || event.price_female != null) ? (
            <Text style={styles.seatsText}>
              {[
                event.price_male != null ? `남 ${event.price_male.toLocaleString()}원` : null,
                event.price_female != null ? `여 ${event.price_female.toLocaleString()}원` : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          ) : (
            <Text style={styles.seatsText}>-</Text>
          )}
        </View>
        {event.age_range_min != null && event.age_range_max != null && (
          <Text style={styles.ageText}>{event.age_range_min}~{event.age_range_max}세</Text>
        )}
      </View>

      {/* 오른쪽 컬럼: 현황 버튼 + 하트 */}
      <View style={styles.rightCol}>
        {hasParticipantData(event.participant_stats) && (
          <TouchableOpacity
            style={styles.statsSmallBtn}
            onPress={(e) => { e.stopPropagation?.(); setStatsVisible(true) }}
            activeOpacity={0.8}
          >
            <Text style={styles.statsSmallBtnText}>현황</Text>
          </TouchableOpacity>
        )}
        {onToggleFavorite && (
          <TouchableOpacity
            style={styles.heart}
            onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
            activeOpacity={0.8}
          >
            <Ionicons name="heart" size={20} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 참가자 현황 바텀시트 */}
      {hasParticipantData(event.participant_stats) && (
        <ParticipantStatsSheet
          visible={statsVisible}
          onClose={() => setStatsVisible(false)}
          stats={event.participant_stats as ParticipantStats}
        />
      )}
    </TouchableOpacity>
  )
}
