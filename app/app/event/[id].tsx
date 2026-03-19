import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { useEventDetail } from '@/hooks/useEventDetail'
import { useReviews } from '@/hooks/useReviews'
import { openOutlink } from '@/lib/outlink'
import { Colors } from '@/constants/colors'
import ThemeTag from '@/components/ThemeTag'
import DeadlineBadge from '@/components/DeadlineBadge'
import ReviewCard from '@/components/ReviewCard'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${
    days[d.getDay()]
  }) ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { event, loading, error } = useEventDetail(id)
  const router = useRouter()

  const companyId = event?.companies?.id ?? null
  const { reviews, loading: reviewsLoading } = useReviews(companyId, 3)

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    )
  }

  if (error || !event) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error ?? '이벤트를 찾을 수 없습니다'}
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>← 돌아가기</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const daysLeft = Math.ceil(
    (new Date(event.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  )

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        {event.thumbnail_urls?.[0] ? (
          <Image
            source={{ uri: event.thumbnail_urls[0] }}
            style={styles.image}
            contentFit="cover"
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

      <View style={styles.content}>
        {/* 업체명 */}
        {event.companies && (
          <TouchableOpacity
            onPress={() => router.push(`/company/${event.companies!.id}`)}
          >
            <Text style={styles.company}>{event.companies.name} →</Text>
          </TouchableOpacity>
        )}

        {/* 제목 */}
        <Text style={styles.title}>{event.title}</Text>

        {/* 기본 정보 */}
        <View style={styles.infoCard}>
          <InfoRow label="일시" value={formatDate(event.event_date)} />
          <InfoRow label="지역" value={event.location_region} />
          {event.location_detail && (
            <InfoRow label="장소" value={event.location_detail} />
          )}
          {event.gender_ratio && (
            <InfoRow label="성비" value={event.gender_ratio} />
          )}
          {(event.capacity_male || event.capacity_female) && (
            <InfoRow
              label="모집"
              value={[
                event.capacity_male ? `남 ${event.capacity_male}명` : null,
                event.capacity_female ? `여 ${event.capacity_female}명` : null,
              ]
                .filter(Boolean)
                .join(' / ')}
            />
          )}
          {(event.price_male || event.price_female) && (
            <InfoRow
              label="참가비"
              value={[
                event.price_male
                  ? `남 ${event.price_male.toLocaleString()}원`
                  : null,
                event.price_female
                  ? `여 ${event.price_female.toLocaleString()}원`
                  : null,
              ]
                .filter(Boolean)
                .join(' / ')}
            />
          )}
          {event.age_range_min && (
            <InfoRow
              label="나이"
              value={`${event.age_range_min}세${event.age_range_max ? ` ~ ${event.age_range_max}세` : ' 이상'}`}
            />
          )}
        </View>

        {/* 테마 태그 */}
        {event.theme && event.theme.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionLabel}>테마</Text>
            <View style={styles.tags}>
              {event.theme.map((t: string) => (
                <ThemeTag key={t} label={t} />
              ))}
            </View>
          </View>
        )}

        {/* 설명 */}
        {event.description && (
          <View style={styles.descSection}>
            <Text style={styles.sectionLabel}>상세 설명</Text>
            <Text style={styles.description}>{event.description}</Text>
          </View>
        )}

        {/* 신청 버튼 */}
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={() => openOutlink(event.source_url)}
        >
          <Text style={styles.ctaBtnText}>신청하기 →</Text>
        </TouchableOpacity>

        {/* 업체 후기 섹션 */}
        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>
              {event.companies?.name ?? '업체'} 후기
            </Text>
            {!reviewsLoading && reviews.length > 0 && (
              <TouchableOpacity onPress={() => router.push('/reviews')}>
                <Text style={styles.moreLink}>전체보기 →</Text>
              </TouchableOpacity>
            )}
          </View>

          {reviewsLoading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 16 }} />
          ) : reviews.length === 0 ? (
            <View style={styles.emptyReviews}>
              <Text style={styles.emptyReviewsText}>아직 등록된 후기가 없습니다</Text>
            </View>
          ) : (
            <View style={styles.reviewsList}>
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  imageContainer: { position: 'relative' },
  image: { width: '100%', height: 260 },
  imagePlaceholder: {
    width: '100%',
    height: 260,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: { fontSize: 64 },
  content: { padding: 20 },
  company: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    color: Colors.textPrimary,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 20,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.textTertiary,
    width: 56,
    fontWeight: '500',
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '500',
  },
  tagsSection: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tags: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  descSection: { marginBottom: 20 },
  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 28,
  },
  ctaBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  reviewsSection: { gap: 0 },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  moreLink: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600',
  },
  emptyReviews: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyReviewsText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  reviewsList: { gap: 0, marginHorizontal: -20 },
  errorText: { color: Colors.error, fontSize: 15 },
  backLink: { color: Colors.primary, fontSize: 14 },
})
