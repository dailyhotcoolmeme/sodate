import React, { useState, useMemo } from 'react'
import { Ionicons } from '@expo/vector-icons'
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
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openOutlink } from '@/lib/outlink'
import { track } from '@/lib/analytics'
import { useAllReviews } from '@/hooks/useReviews'
import { useColors } from '@/hooks/useColors'
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
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    thumb: { width: THUMB_W },
    thumbImg: { width: THUMB_W, height: THUMB_W * 0.75, borderRadius: 10 },
    thumbPlaceholder: {
      width: THUMB_W,
      height: THUMB_W * 0.75,
      borderRadius: 10,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbPlaceholderIcon: { fontSize: 14, color: colors.textTertiary, fontWeight: '600' },
    thumbOverlay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    thumbSource: {
      fontSize: 11,
      color: colors.primary,
      fontWeight: '600',
      backgroundColor: colors.primary + '18',
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
    },
    thumbRating: { fontSize: 12, color: '#FFB800' },
    thumbContent: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  }), [colors])

  return (
    <TouchableOpacity
      style={styles.thumb}
      onPress={() => { track('review_click', { companyId: review.company_id, properties: { source: review.source } }); openOutlink(review.source_url) }}
      activeOpacity={0.82}
    >
      {review.thumbnail_url ? (
        <Image source={{ uri: review.thumbnail_url }} style={styles.thumbImg} contentFit="cover" />
      ) : (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbPlaceholderIcon}>후기</Text>
        </View>
      )}
      <View style={styles.thumbOverlay}>
        <Text style={styles.thumbSource}>{SOURCE_LABELS[review.source] ?? review.source}</Text>
        {review.rating && (
          <View style={{ flexDirection: 'row' }}>
            {Array.from({ length: review.rating }).map((_, i) => (
              <Ionicons key={i} name="star" size={12} color="#FFB800" />
            ))}
          </View>
        )}
      </View>
      <Text style={styles.thumbContent} numberOfLines={2}>{review.content}</Text>
    </TouchableOpacity>
  )
}

function CompanySection({ name, reviews }: { name: string; reviews: ReviewWithCompany[] }) {
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    section: { marginTop: 20 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginBottom: 10,
    },
    sectionName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
    sectionCount: { fontSize: 12, color: colors.textTertiary },
    thumbRow: { paddingHorizontal: 16, gap: 10 },
  }), [colors])

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
  const router = useRouter()
  const { reviews, loading } = useAllReviews(80)
  const [activeTab, setActiveTab] = useState('전체')

  React.useEffect(() => { track('screen_view', { properties: { screen: 'reviews' } }) }, [])
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
    },
    backBtn: { paddingVertical: 4, marginBottom: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    tabScroll: { flexShrink: 0 },
    tabRow: { paddingHorizontal: 16, gap: 8, alignItems: 'flex-start' },
    tab: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: colors.surfaceHigh,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
    tabTextActive: { color: '#fff', fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
    emptySubText: { fontSize: 13, color: colors.textTertiary },
  }), [colors])

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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={16} color={colors.primary} /><Text style={styles.backText}>홈</Text>
        </TouchableOpacity>
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
          <ActivityIndicator color={colors.primary} />
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
