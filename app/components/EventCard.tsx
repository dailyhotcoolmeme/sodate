import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { openOutlink } from '@/lib/outlink'
import { Colors } from '@/constants/colors'
import type { EventWithCompany } from '@/lib/supabase'
import DeadlineBadge from './DeadlineBadge'
import ThemeTag from './ThemeTag'
import CompanyBadge from './CompanyBadge'

interface Props {
  event: EventWithCompany
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function EventCard({ event }: Props) {
  const router = useRouter()

  const handleApply = () => openOutlink(event.source_url)
  const handleCardPress = () => router.push(`/event/${event.id}`)

  const daysLeft = Math.ceil(
    (new Date(event.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handleCardPress}
      activeOpacity={0.85}
    >
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        {event.thumbnail_urls?.[0] ? (
          <Image
            source={{ uri: event.thumbnail_urls[0] }}
            style={styles.image}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>💑</Text>
          </View>
        )}
        {daysLeft <= 3 && daysLeft >= 0 && (
          <DeadlineBadge daysLeft={daysLeft} />
        )}
      </View>

      {/* 카드 내용 */}
      <View style={styles.content}>
        {/* 업체 배지 */}
        {event.companies && (
          <CompanyBadge
            name={event.companies.name}
            logoUrl={event.companies.logo_url}
          />
        )}

        {/* 제목 */}
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>

        {/* 날짜 + 지역 */}
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatDate(event.event_date)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{event.location_region}</Text>
        </View>

        {/* 성비 + 가격 */}
        {(event.gender_ratio || event.price_male || event.price_female) && (
          <View style={styles.metaRow}>
            {event.gender_ratio && (
              <Text style={styles.meta}>{event.gender_ratio}</Text>
            )}
            {event.price_male && (
              <Text style={styles.price}>
                남 {event.price_male.toLocaleString()}원
              </Text>
            )}
            {event.price_female && (
              <Text style={styles.price}>
                여 {event.price_female.toLocaleString()}원
              </Text>
            )}
          </View>
        )}

        {/* 테마 태그 */}
        {event.theme && event.theme.length > 0 && (
          <View style={styles.tags}>
            {event.theme.slice(0, 3).map((t: string) => (
              <ThemeTag key={t} label={t} />
            ))}
          </View>
        )}

        {/* 신청 버튼 */}
        <TouchableOpacity style={styles.cta} onPress={handleApply}>
          <Text style={styles.ctaText}>신청하기 →</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    overflow: 'hidden',
  },
  imageContainer: { position: 'relative' },
  image: { width: '100%', height: 200 },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: { fontSize: 48 },
  content: { padding: 16, gap: 4 },
  title: {
    fontSize: 16,
    color: Colors.textPrimary,
    fontWeight: '700',
    marginVertical: 6,
    lineHeight: 22,
  },
  metaRow: { flexDirection: 'row', gap: 12, marginTop: 2 },
  meta: { fontSize: 13, color: Colors.textSecondary },
  metaDot: { fontSize: 13, color: Colors.textTertiary, marginHorizontal: 4 },
  price: { fontSize: 13, color: Colors.textSecondary },
  tags: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  cta: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
