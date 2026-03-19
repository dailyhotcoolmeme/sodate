import { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openOutlink } from '@/lib/outlink'
import { useAllReviews } from '@/hooks/useReviews'
import { Colors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'

const { width: SCREEN_W } = Dimensions.get('window')
const THUMB_W = SCREEN_W * 0.42

type ReviewWithCompany = ReviewRow & { companies: { name: string; slug: string } | null }

const SOURCE_LABELS: Record<string, string> = {
  naver_blog: '블로그',
  instagram: '인스타',
  kakao: '카카오',
  manual: '직접',
}

function ReviewThumb({ review }: { review: ReviewWithCompany }) {
  return (
    <TouchableOpacity
      style={styles.thumb}
      onPress={() => openOutlink(review.source_url)}
      activeOpacity={0.82}
    >
      {review.thumbnail_url ? (
        <Image source={{ uri: review.thumbnail_url }} style={styles.thumbImg} contentFit="cover" />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbPlaceholderIcon}>💬</Text>
        </View>
      )}
      <View style={styles.thumbOverlay}>
        <Text style={styles.thumbSource}>{SOURCE_LABELS[review.source] ?? review.source}</Text>
        {review.rating && (
          <Text style={styles.thumbRating}>{'★'.repeat(review.rating)}</Text>
        )}
      </View>
      <Text style={styles.thumbContent} numberOfLines={2}>{review.content}</Text>
    </TouchableOpacity>
  )
}

function CompanySection({ name, reviews }: { name: string; reviews: ReviewWithCompany[] }) {
  if (reviews.length === 0) return null
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionName}>{name}</Text>
        <Text style={styles.sectionCount}>후기 {reviews.length}건</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbRow}
      >
        {reviews.map((r) => <ReviewThumb key={r.id} review={r} />)}
      </ScrollView>
    </View>
  )
}

const TABS = ['전체', '네이버 블로그', '인스타그램']
const TAB_SOURCES: Record<string, string | null> = {
  '전체': null,
  '네이버 블로그': 'naver_blog',
  '인스타그램': 'instagram',
}

export default function ReviewsScreen() {
  const insets = useSafeAreaInsets()
  const { reviews, loading } = useAllReviews(80)
  const [activeTab, setActiveTab] = useState('전체')

  // 필터링
  const filterSource = TAB_SOURCES[activeTab]
  const filtered = filterSource
    ? reviews.filter((r) => r.source === filterSource)
    : reviews

  // 업체별 그룹핑
  const byCompany: Record<string, { name: string; items: ReviewWithCompany[] }> = {}
  for (const r of filtered) {
    const key = r.company_id
    const name = r.companies?.name ?? '기타'
    if (!byCompany[key]) byCompany[key] = { name, items: [] }
    byCompany[key].items.push(r)
  }
  const sections = Object.values(byCompany)

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.title}>후기 모아보기</Text>
        <Text style={styles.subtitle}>실제 참여자들의 솔직한 후기</Text>
      </View>

      {/* 소스 탭 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        style={styles.tabScroll}
      >
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>아직 후기가 없습니다</Text>
          <Text style={styles.emptySubText}>크롤링 후 업데이트됩니다</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20, paddingTop: 8 }}
        >
          {sections.map((sec) => (
            <CompanySection key={sec.name} name={sec.name} reviews={sec.items} />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  tabScroll: { maxHeight: 44 },
  tabRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surfaceHigh,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  section: { marginTop: 20 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  sectionCount: { fontSize: 12, color: Colors.textTertiary },
  thumbRow: { paddingHorizontal: 16, gap: 10 },
  thumb: { width: THUMB_W },
  thumbImg: { width: THUMB_W, height: THUMB_W * 0.75, borderRadius: 10 },
  thumbPlaceholder: {
    width: THUMB_W,
    height: THUMB_W * 0.75,
    borderRadius: 10,
    backgroundColor: Colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderIcon: { fontSize: 32 },
  thumbOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  thumbSource: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600',
    backgroundColor: Colors.primary + '18',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  thumbRating: { fontSize: 12, color: '#FFB800' },
  thumbContent: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 16, color: Colors.textSecondary, fontWeight: '600' },
  emptySubText: { fontSize: 13, color: Colors.textTertiary },
})
