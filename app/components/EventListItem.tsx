import React, { useMemo, useState } from 'react'
import EventThumbnail from './EventThumbnail'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import DeadlineBadge from './DeadlineBadge'
import ThemeBadge from './ThemeBadge'
import PartnerBadge from './PartnerBadge'
import { isPartnerCompany } from '@/lib/partner'
import HashtagChips from './HashtagChips'
import { daysUntil } from '@/lib/dday'
import PriceTierValue from '@/components/PriceTierValue'

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
  const [imgError, setImgError] = useState(false)
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
      overflow: 'hidden',
    },
    closedOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    closedBadge: {
      backgroundColor: 'rgba(24,24,27,0.72)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.22)',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 10,
    },
    closedBadgeText: {
      color: '#fff',
      fontSize: 12.5,
      fontWeight: '700',
      letterSpacing: 1,
    },
    leftCol: { alignItems: 'center', width: THUMB },
    thumbWrap: { position: 'relative' },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10 },
    companyUnder: { fontSize: 11, color: colors.textTertiary, fontWeight: '600', marginTop: 4, maxWidth: THUMB, textAlign: 'left', alignSelf: 'flex-start' },
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
      top: 4,
      left: 4,
      backgroundColor: colors.deadline,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    deadlineText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    // alignSelf flex-start: 왼쪽칸(썸네일+업체명)이 더 높아도 info가 콘텐츠 높이로 top-정렬
    // → 제목 1줄/2줄 상관없이 행 간격이 gap:2로 균일(늘어나며 분산되는 것 방지)
    info: { flex: 1, gap: 2, alignSelf: 'flex-start' },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
    // 제목 박스가 1줄 내용에도 2줄 높이를 잡아 제목-해시태그 간격이 벌어지는 문제 →
    // iOS에서 maxHeight+overflow가 1줄로 클램프돼 numberOfLines={2}로 변경(2줄 표준)
    title: { flex: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 19 },
    meta: { fontSize: 12, color: colors.textSecondary },
    price: { fontSize: 12, color: colors.textSecondary },
    seatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    seatsLabel: { fontSize: 12, color: colors.textSecondary, marginRight: 6 },
    seatsText: { fontSize: 12, color: colors.textPrimary, fontWeight: '500' },
    genderBlock: { gap: 2 },
    genderRow: { flexDirection: 'row', alignItems: 'center' },
    genderTag: { fontSize: 12.5, fontWeight: '700', marginRight: 7, width: 28 },
    genderMale: { color: '#3B82F6' },
    genderFemale: { color: colors.primary },
    genderInfo: { flex: 1, fontSize: 12.5, color: colors.textSecondary, fontWeight: '500' },
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
      {/* 썸네일 + 업체명(썸네일 밑) */}
      <View style={styles.leftCol}>
        <View style={styles.thumbWrap}>
          <EventThumbnail
            url={event.thumbnail_urls?.[0]}
            companyName={event.companies?.name}
            region={event.location_region}
            style={styles.thumb}
            size="small"
          />
          {daysLeft <= 3 && daysLeft >= 0 && (
            <View style={styles.deadlineDot}>
              <Text style={styles.deadlineText}>{daysLeft === 0 ? '오늘' : `D-${daysLeft}`}</Text>
            </View>
          )}
        </View>
        {event.companies && (
          <Text style={styles.companyUnder} numberOfLines={1}>{event.companies.name}</Text>
        )}
      </View>

      {/* 내용 */}
      <View style={styles.info}>
        <View style={styles.titleRow}>
          {isPartnerCompany(event.companies) && <PartnerBadge />}
          <ThemeBadge theme={event.theme} />
          <Text style={styles.title} numberOfLines={2}>{cleanTitle(event.title)}</Text>
        </View>
        {/* 해시태그 배지 (제목 바로 아래) */}
        <HashtagChips hashtags={event.hashtags} size="sm" tight />
        <Text style={styles.meta}>{formatDate(event.event_date)} · {event.location_region}</Text>
        {(() => {
          const hasM = event.price_male != null || !!event.price_detail?.male || !!event.age_male
          const hasF = event.price_female != null || !!event.price_detail?.female || !!event.age_female
          if (!hasM && !hasF) return null
          // 이벤트 전체가 마감이면 성별 좌석 데이터와 상관없이 둘 다 마감으로 본다
          // (크롤러가 is_closed는 갱신해도 seats_left_male/female은 안 갱신한 경우가 있어,
          //  마감 배지는 뜨는데 성별 가격엔 취소선이 안 붙는 불일치가 있었다 — 2026-08-02 오너 지적)
          const soldM = event.is_closed || (event.seats_left_male != null && event.seats_left_male <= 0)
          const soldF = event.is_closed || (event.seats_left_female != null && event.seats_left_female <= 0)
          return (
            <View style={styles.genderBlock}>
              {hasM && (
                <View style={styles.genderRow}>
                  <Text style={[styles.genderTag, styles.genderMale]}>남성</Text>
                  <View style={styles.genderInfo}><PriceTierValue detail={event.price_detail?.male} price={event.price_male} age={event.age_male} soldout={soldM} compact /></View>
                </View>
              )}
              {hasF && (
                <View style={styles.genderRow}>
                  <Text style={[styles.genderTag, styles.genderFemale]}>여성</Text>
                  <View style={styles.genderInfo}><PriceTierValue detail={event.price_detail?.female} price={event.price_female} age={event.age_female} soldout={soldF} compact /></View>
                </View>
              )}
            </View>
          )
        })()}
      </View>

      {/* 오른쪽 컬럼: 하트 */}
      <View style={styles.rightCol}>
        {onToggleFavorite && (
          <TouchableOpacity
            style={styles.heart}
            onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
            activeOpacity={0.8}
          >
            <Ionicons name="bookmark" size={20} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* 마감 처리 — 흐림 + 중앙 마감 배지 */}
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
