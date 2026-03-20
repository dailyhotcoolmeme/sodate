import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import DeadlineBadge from './DeadlineBadge'

interface Props {
  event: EventWithCompany
  isFavorite?: boolean
  onToggleFavorite?: () => void
}

// 렌더링 깨지는 이모지/특수문자 제거 (Hermes 호환)
function cleanTitle(title: string): string {
  return title
    .replace(/^\[[^\]]+\]\s*/, '')  // [업체명] 접두어 제거
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const COMPANY_COLORS: Record<string, string> = {
  '모드파티': '#6C3CE1',
  '연인어때': '#E84393',
  '러브캐스팅': '#E85D04',
  '솔로오프': '#7B2D8B',
  '에모셔널오렌지': '#F4842B',
  '러브매칭': '#C62A47',
  '프립': '#00B4D8',
  '문토': '#2D6A4F',
  '토크블라썸': '#F72585',
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
    heart: { paddingLeft: 4, paddingTop: 2 },
    heartIcon: { fontSize: 18, color: colors.textTertiary },
    heartActive: { color: colors.primary },
  }), [colors])

  const daysLeft = Math.ceil((new Date(event.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))

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
            <Text style={styles.deadlineText}>D-{daysLeft}</Text>
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
        {(event.price_male || event.price_female) && (
          <Text style={styles.price}>
            {event.price_male ? `남 ${event.price_male.toLocaleString()}원` : ''}
            {event.price_male && event.price_female ? '  ' : ''}
            {event.price_female ? `여 ${event.price_female.toLocaleString()}원` : ''}
          </Text>
        )}
      </View>

      {/* 하트 */}
      {onToggleFavorite && (
        <TouchableOpacity
          style={styles.heart}
          onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
          activeOpacity={0.8}
        >
          <Text style={[styles.heartIcon, isFavorite && styles.heartActive]}>
            {isFavorite ? '♥' : '♡'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  )
}
