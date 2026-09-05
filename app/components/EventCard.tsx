import React, { useMemo, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import type { EventWithCompany } from '@/lib/supabase'
import DeadlineBadge from './DeadlineBadge'
import ThemeBadge from './ThemeBadge'
import HashtagChips from './HashtagChips'
import { daysUntil } from '@/lib/dday'
import PriceTierValue from '@/components/PriceTierValue'
import EventThumbnail from './EventThumbnail'
import PartnerBadge from './PartnerBadge'
import { isPartnerCompany } from '@/lib/partner'
import FavoriteButton from './FavoriteButton'

interface Props {
  event: EventWithCompany
  isFavorite?: boolean
  onToggleFavorite?: () => void
}


function cleanTitle(title: string): string {
  return title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/_E\d+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function EventCard({ event, isFavorite = false, onToggleFavorite }: Props) {
  const router = useRouter()
  const colors = useColors()
  const [imgError, setImgError] = useState(false)
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border, // 다크배경(#0F0F0F)에 카드(#1A1A1A)가 묻혀 안 보이던 문제 → 테두리로 경계
      marginHorizontal: 16,
      marginVertical: 8,
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
      paddingHorizontal: 16,
      paddingVertical: 7,
      borderRadius: 12,
    },
    closedBadgeText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 1,
    },
    imageContainer: { position: 'relative' },
    image: { width: '100%', height: 200 },
    imagePlaceholder: {
      width: '100%',
      height: 200,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imagePlaceholderText: { fontSize: 48 },
    heartBtn: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heartBtnActive: {
      borderColor: '#FF6B9D',
      backgroundColor: '#FF6B9D18',
    },
    content: { padding: 16, gap: 2 },  // 리스트형(info gap:2)과 줄간격 통일
    company: { fontSize: 11, color: colors.textTertiary, fontWeight: '600' },  // 리스트형과 동일
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    // iOS에선 maxHeight+overflow가 1줄로 클램프돼버림 → numberOfLines={2}로 2줄 표준 처리
    title: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
      fontWeight: '700',
      lineHeight: 21,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    meta: { fontSize: 13, color: colors.textSecondary },
    metaDot: { fontSize: 13, color: colors.textTertiary, marginHorizontal: 5 },
    price: { fontSize: 13, color: colors.textSecondary },
    seatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    seatsLabel: { fontSize: 13, color: colors.textSecondary, marginRight: 6 },
    seatsValue: { fontSize: 13, fontWeight: '600' },
    genderBlock: { gap: 2 },
    genderRow: { flexDirection: 'row', alignItems: 'center' },
    genderTag: { fontSize: 13, fontWeight: '700', marginRight: 8, width: 30 },
    genderMale: { color: '#3B82F6' },
    genderFemale: { color: colors.primary },
    genderInfo: { flex: 1, fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
    seatsSep: { fontSize: 13, color: colors.textTertiary, marginHorizontal: 4 },
    tags: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
    ctaRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    cta: {
      flex: 2,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
    },
    ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    ctaClosed: { backgroundColor: '#e5e7eb' },
    ctaClosedText: { color: '#9ca3af', fontWeight: '700', fontSize: 14 },
    statsBtn: {
      flex: 1,
      borderRadius: 10,
      paddingVertical: 10,
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: '#9B59F5',
    },
    statsBtnText: { color: '#9B59F5', fontWeight: '700', fontSize: 13 },
    ageBadge: {
      position: 'absolute',
      top: 10,
      left: 10,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    ageBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  }), [colors])

  const handleApply = () => openOutlink(event.source_url)
  const handleCardPress = () => router.push(`/event/${event.id}`)

  const daysLeft = daysUntil(event.event_date)

  const seatColor = (n: number | null) => {
    if (n == null) return undefined
    if (n <= 1) return colors.error
    if (n <= 3) return colors.warning
    return colors.textPrimary
  }

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handleCardPress}
      activeOpacity={0.85}
    >
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        <EventThumbnail
          url={event.thumbnail_urls?.[0]}
          companyName={event.companies?.name}
          region={event.location_region}
          style={styles.image}
          size="large"
        />
        {daysLeft <= 3 && daysLeft >= 0 && (
          <DeadlineBadge daysLeft={daysLeft} />
        )}
        {/* 하트 버튼 — 오른쪽 상단 */}
        {onToggleFavorite && (
          <TouchableOpacity
            style={[styles.heartBtn, isFavorite && styles.heartBtnActive]}
            onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }}
            activeOpacity={0.8}
          >
            <Ionicons
              name="bookmark"
              size={18}
              color={isFavorite ? '#FF6B9D' : colors.textTertiary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* 카드 내용 */}
      <View style={styles.content}>
        {/* 업체명 — 리스트형과 동일 스타일 */}
        {event.companies && (
          <Text style={styles.company}>{event.companies.name}</Text>
        )}

        {/* 테마 배지 + 제목 (같은 줄) */}
        <View style={styles.titleRow}>
          {/* 제휴업체 딱지 — 테마 배지보다 앞. 둘 다 붙는 일은 드물지만, 붙으면
              '모잇 할인'이 먼저 읽혀야 한다(2026-09-02 오너 지시). */}
          {isPartnerCompany(event.companies) && <PartnerBadge />}
          <ThemeBadge theme={event.theme} />
          <Text style={styles.title} numberOfLines={2}>
            {cleanTitle(event.title)}
          </Text>
        </View>

        {/* 해시태그 배지 (제목 바로 아래) */}
        <HashtagChips hashtags={event.hashtags} size="sm" />

        {/* 날짜 · 지역 · 나이대 */}
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatDate(event.event_date)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{event.location_region}</Text>
        </View>

        {/* 남성 / 여성 한 줄 요약 (품절이면 취소선) */}
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
                  <View style={styles.genderInfo}><PriceTierValue detail={event.price_detail?.male} price={event.price_male} partnerPrice={event.partner_price_male} age={event.age_male} soldout={soldM} compact /></View>
                </View>
              )}
              {hasF && (
                <View style={styles.genderRow}>
                  <Text style={[styles.genderTag, styles.genderFemale]}>여성</Text>
                  <View style={styles.genderInfo}><PriceTierValue detail={event.price_detail?.female} price={event.price_female} partnerPrice={event.partner_price_female} age={event.age_female} soldout={soldF} compact /></View>
                </View>
              )}
            </View>
          )
        })()}

        {/* 신청 버튼 */}
        <View style={styles.ctaRow}>
          {/* 마감이어도 눌러서 업체 사이트로 갈 수 있게 둔다(오너 확정, 2026-07-29).
              참가자가 계속 바뀌어 자리가 다시 나므로 앱에서 막으면 신청 기회를 잃는다.
              회색 '신청 마감' 모양은 그대로. */}
          <TouchableOpacity
            style={[styles.cta, event.is_closed && styles.ctaClosed]}
            onPress={handleApply}
          >
            <Text style={event.is_closed ? styles.ctaClosedText : styles.ctaText}>
              {event.is_closed ? '신청 마감' : '신청하기  ›'}
            </Text>
          </TouchableOpacity>
        </View>
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
