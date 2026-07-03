import React, { useMemo, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Dimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import ReviewCard from '@/components/ReviewCard'
import type { ReviewRow } from '@/lib/supabase'
import type { AppColors } from '@/constants/colors'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type TabKey = 'user' | 'blog' | 'instagram'

interface Props {
  reviews: ReviewRow[]
  myReviewIds: string[]
  onEdit: (review: ReviewRow) => void
  onDelete: (review: ReviewRow) => void
  onReport: (review: ReviewRow) => void
}

export default function ReviewSection({ reviews, myReviewIds, onEdit, onDelete, onReport }: Props) {
  const colors = useColors()

  // 소스별 그룹핑
  const userReviews = useMemo(() => reviews.filter((r) => r.source === 'user'), [reviews])
  const blogReviews = useMemo(() => reviews.filter((r) => r.source === 'naver_blog'), [reviews])
  const instaReviews = useMemo(() => reviews.filter((r) => r.source === 'instagram'), [reviews])

  // 탭 구성 (건수 0인 탭은 제외)
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; count: number }[] = []
    if (userReviews.length > 0) list.push({ key: 'user', label: '소개팅모아', count: userReviews.length })
    if (blogReviews.length > 0) list.push({ key: 'blog', label: '블로그', count: blogReviews.length })
    if (instaReviews.length > 0) list.push({ key: 'instagram', label: '인스타', count: instaReviews.length })
    return list
  }, [userReviews.length, blogReviews.length, instaReviews.length])

  const [activeTab, setActiveTab] = useState<TabKey | null>(null)
  // 기본 활성: 소개팅모아 있으면 그것, 없으면 첫 탭
  const currentTab: TabKey | null = useMemo(() => {
    if (activeTab && tabs.some((t) => t.key === activeTab)) return activeTab
    return tabs[0]?.key ?? null
  }, [activeTab, tabs])

  // 평균 별점 (사용자 후기의 rating 평균, 소수 1자리)
  const avgRating = useMemo(() => {
    const rated = userReviews.filter((r) => typeof r.rating === 'number' && r.rating! > 0)
    if (rated.length === 0) return null
    const sum = rated.reduce((acc, r) => acc + (r.rating ?? 0), 0)
    return Math.round((sum / rated.length) * 10) / 10
  }, [userReviews])

  const styles = useMemo(() => makeStyles(colors), [colors])

  const totalCount = reviews.length

  if (totalCount === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>아직 등록된 후기가 없습니다</Text>
      </View>
    )
  }

  return (
    <View style={styles.section}>
      {/* 상단 요약 */}
      <View style={styles.summaryRow}>
        {avgRating !== null && (
          <View style={styles.avgWrap}>
            <Ionicons name="star" size={18} color="#FFB800" />
            <Text style={styles.avgText}>{avgRating.toFixed(1)}</Text>
          </View>
        )}
        <Text style={styles.countText}>후기 {totalCount}개</Text>
      </View>

      {/* 책갈피 탭 */}
      {tabs.length > 0 && (
        <View style={styles.tabRow}>
          {tabs.map((t) => {
            const active = t.key === currentTab
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                  {t.label}({t.count})
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}

      {/* 탭별 내용 */}
      {currentTab === 'user' && (
        <View style={styles.userList}>
          {userReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              isMine={myReviewIds.includes(review.id)}
              hideSourceBadge
              onEdit={onEdit}
              onDelete={onDelete}
              onReport={onReport}
            />
          ))}
        </View>
      )}

      {currentTab === 'blog' && (
        <BlogGallery reviews={blogReviews} styles={styles} />
      )}

      {currentTab === 'instagram' && (
        <View>
          {instaReviews.map((review) => (
            <TouchableOpacity
              key={review.id}
              style={styles.instaRow}
              activeOpacity={review.source_url ? 0.7 : 1}
              disabled={!review.source_url}
              onPress={() => review.source_url && openOutlink(review.source_url)}
            >
              <View style={styles.instaBody}>
                <Text style={styles.instaSource}>인스타그램</Text>
                <Text style={styles.instaText} numberOfLines={2}>{cleanText(review.content ?? '')}</Text>
              </View>
              {review.source_url && <Text style={styles.instaMore}>보러가기 ›</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    section: { marginTop: 4 },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    avgWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    avgText: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
    countText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
    tabRow: { flexDirection: 'row', gap: 20, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
    tabBtn: { paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabLabel: { fontSize: 14, fontWeight: '600', color: colors.textTertiary },
    tabLabelActive: { color: colors.primary },
    // 소개팅모아 목록: content 좌우 패딩(20) 상쇄해 ReviewCard 자체 여백 적용
    userList: { marginHorizontal: -20 },
    // 블로그 갤러리
    gallerySlide: { justifyContent: 'center' },
    galleryImageWrap: {
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.surfaceHigh,
      aspectRatio: 4 / 3,
    },
    galleryImage: { width: '100%', height: '100%' },
    galleryOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 3,
    },
    galleryOverlaySource: { fontSize: 11, fontWeight: '700', color: '#FFB0CD' },
    galleryOverlayText: { fontSize: 13, color: '#FFFFFF', lineHeight: 18 },
    dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
    dotActive: { backgroundColor: colors.primary, width: 18 },
    // 블로그 - 썸네일 없는 후기 텍스트 링크 목록
    linkList: { marginTop: 16, gap: 2 },
    // 인스타 리스트
    instaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    instaBody: { flex: 1, gap: 4 },
    instaSource: { fontSize: 11, fontWeight: '700', color: colors.primary },
    instaText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
    instaMore: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    textLinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    textLinkText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
    textLinkMore: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    empty: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
    },
    emptyText: { fontSize: 13, color: colors.textTertiary },
  })
}

// 블로그 탭: 가로 스와이프 썸네일 갤러리 + 점 인디케이터
function BlogGallery({
  reviews,
  styles,
}: {
  reviews: ReviewRow[]
  styles: ReturnType<typeof makeStyles>
}) {
  const withThumb = useMemo(() => reviews.filter((r) => !!r.thumbnail_url), [reviews])
  const withoutThumb = useMemo(() => reviews.filter((r) => !r.thumbnail_url), [reviews])

  // content 좌우 패딩(20)을 감안한 슬라이드 폭
  const slideWidth = Dimensions.get('window').width - 40
  const [index, setIndex] = useState(0)

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x
    setIndex(Math.round(x / slideWidth))
  }, [slideWidth])

  return (
    <View>
      {withThumb.length > 0 && (
        <>
          <FlatList
            data={withThumb}
            keyExtractor={(r) => r.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={slideWidth}
            decelerationRate="fast"
            onMomentumScrollEnd={onScrollEnd}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.gallerySlide, { width: slideWidth }]}
                activeOpacity={item.source_url ? 0.85 : 1}
                disabled={!item.source_url}
                onPress={() => item.source_url && openOutlink(item.source_url)}
              >
                <View style={styles.galleryImageWrap}>
                  <Image
                    source={{ uri: item.thumbnail_url! }}
                    style={styles.galleryImage}
                    contentFit="cover"
                  />
                  <View style={styles.galleryOverlay}>
                    <Text style={styles.galleryOverlaySource}>네이버 블로그</Text>
                    <Text style={styles.galleryOverlayText} numberOfLines={1}>
                      {cleanText(item.content ?? '')}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
          {withThumb.length > 1 && (
            <View style={styles.dotsRow}>
              {withThumb.map((r, i) => (
                <View key={r.id} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          )}
        </>
      )}

      {/* 썸네일 없는 블로그 후기 — 텍스트 링크 목록 */}
      {withoutThumb.length > 0 && (
        <View style={withThumb.length > 0 ? styles.linkList : undefined}>
          {withoutThumb.map((review) => (
            <TouchableOpacity
              key={review.id}
              style={styles.textLinkRow}
              activeOpacity={review.source_url ? 0.7 : 1}
              disabled={!review.source_url}
              onPress={() => review.source_url && openOutlink(review.source_url)}
            >
              <Text style={styles.textLinkText} numberOfLines={2}>{cleanText(review.content ?? '')}</Text>
              {review.source_url && <Text style={styles.textLinkMore}>보러가기 ›</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )
}
