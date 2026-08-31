import React, { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import ReviewCard from '@/components/ReviewCard'
import type { ReviewRow } from '@/lib/supabase'
import type { AppColors } from '@/constants/colors'

// 최신순 정렬: 게시일(published_at) 우선, 없으면(인스타·유튜브) 수집일(created_at)
function byNewest(a: ReviewRow, b: ReviewRow): number {
  const da = new Date(a.published_at ?? a.created_at ?? 0).getTime()
  const db = new Date(b.published_at ?? b.created_at ?? 0).getTime()
  return db - da
}

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type TabKey = 'user' | 'blog' | 'instagram' | 'youtube'

interface Props {
  reviews: ReviewRow[]
  myReviewIds: string[]
  onEdit: (review: ReviewRow) => void
  onDelete: (review: ReviewRow) => void
  onReport: (review: ReviewRow) => void
}

export default function ReviewSection({ reviews, myReviewIds, onEdit, onDelete, onReport }: Props) {
  const colors = useColors()

  const userReviews = useMemo(() => reviews.filter((r) => r.source === 'user').sort(byNewest), [reviews])
  const blogReviews = useMemo(() => reviews.filter((r) => r.source === 'naver_blog').sort(byNewest), [reviews])
  const instaReviews = useMemo(() => reviews.filter((r) => r.source === 'instagram').sort(byNewest), [reviews])
  const youtubeReviews = useMemo(() => reviews.filter((r) => r.source === 'youtube').sort(byNewest), [reviews])

  // 모잇 탭은 항상 표시(0개여도). 나머지 출처는 있을 때만.
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; count: number }[] = [
      { key: 'user', label: '모잇', count: userReviews.length },
    ]
    if (blogReviews.length > 0) list.push({ key: 'blog', label: '블로그', count: blogReviews.length })
    if (instaReviews.length > 0) list.push({ key: 'instagram', label: '인스타', count: instaReviews.length })
    if (youtubeReviews.length > 0) list.push({ key: 'youtube', label: '유튜브', count: youtubeReviews.length })
    return list
  }, [userReviews.length, blogReviews.length, instaReviews.length, youtubeReviews.length])

  const [activeTab, setActiveTab] = useState<TabKey>('user')
  const currentTab: TabKey = tabs.some((t) => t.key === activeTab) ? activeTab : 'user'

  const avgRating = useMemo(() => {
    const rated = userReviews.filter((r) => typeof r.rating === 'number' && r.rating! > 0)
    if (rated.length === 0) return null
    const sum = rated.reduce((acc, r) => acc + (r.rating ?? 0), 0)
    return Math.round((sum / rated.length) * 10) / 10
  }, [userReviews])

  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.section}>
      {/* 별점 평균(사용자 후기 있을 때만). 총 개수는 탭 라벨에 표시하므로 생략 */}
      {avgRating !== null && (
        <View style={styles.summaryRow}>
          <Ionicons name="star" size={18} color="#FFB800" />
          <Text style={styles.avgText}>{avgRating.toFixed(1)}</Text>
        </View>
      )}

      {/* 책갈피 탭 — 가로 균등분할 */}
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
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {t.label}({t.count})
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* 탭별 내용 */}
      {currentTab === 'user' && (
        userReviews.length > 0 ? (
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
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="chatbubble-ellipses-outline" size={30} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>아직 모잇 후기가 없어요</Text>
            <Text style={styles.emptySub}>이 업체에 다녀오셨다면 첫 후기를 남겨보세요!</Text>
          </View>
        )
      )}

      {currentTab === 'blog' &&
        blogReviews.map((r) => (
          <ReviewListRow key={r.id} review={r} sourceLabel="네이버 블로그" icon="logo-rss" styles={styles} colors={colors} />
        ))}

      {currentTab === 'instagram' &&
        instaReviews.map((r) => (
          <ReviewListRow
            key={r.id}
            review={r}
            sourceLabel="인스타그램"
            icon="logo-instagram"
            playable={/\/reel/.test(r.source_url ?? '')}
            styles={styles}
            colors={colors}
          />
        ))}

      {currentTab === 'youtube' &&
        youtubeReviews.map((r) => (
          <ReviewListRow
            key={r.id}
            review={r}
            sourceLabel={/\/shorts\//.test(r.source_url ?? '') ? '유튜브 쇼츠' : '유튜브'}
            icon="logo-youtube"
            playable
            styles={styles}
            colors={colors}
          />
        ))}
    </View>
  )
}

// 블로그·인스타 공용 리스트 한 줄: [썸네일] + [출처 · 제목 · 본문 2줄]
// 썸네일 없으면(인스타 등) 같은 크기의 아이콘 박스.
function ReviewListRow({
  review,
  sourceLabel,
  icon,
  playable = false,
  styles,
  colors,
}: {
  review: ReviewRow
  sourceLabel: string
  icon: keyof typeof Ionicons.glyphMap
  playable?: boolean
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
}) {
  const title = review.author_name ? cleanText(review.author_name) : ''
  const body = cleanText(review.content ?? '')
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={review.source_url ? 0.7 : 1}
      disabled={!review.source_url}
      onPress={() => review.source_url && openOutlink(review.source_url)}
    >
      <View style={styles.rowThumbWrap}>
        {review.thumbnail_url ? (
          <Image source={{ uri: review.thumbnail_url }} style={styles.rowThumb} contentFit="cover" />
        ) : (
          <View style={[styles.rowThumb, styles.rowThumbPlaceholder]}>
            <Ionicons name={icon} size={26} color={colors.textTertiary} />
          </View>
        )}
        {playable && (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={15} color="#fff" style={{ marginLeft: 2 }} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowSource}>{sourceLabel}</Text>
        {!!title && (
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        <Text style={styles.rowBody} numberOfLines={title ? 2 : 3}>
          {body}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    section: { marginTop: 4 },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    avgWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    avgText: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
    countText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
    // 탭 — 가로 3등분 균등분할
    tabRow: { flexDirection: 'row', marginBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
    tabBtn: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 2,
      paddingBottom: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabLabel: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
    tabLabelActive: { color: colors.primary },
    userList: { marginHorizontal: -20, marginTop: 12 },
    emptyBox: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      paddingVertical: 28,
      paddingHorizontal: 20,
      alignItems: 'center',
      gap: 8,
      marginTop: 16,
    },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    emptySub: { fontSize: 13, color: colors.textTertiary, textAlign: 'center' },
    // 리스트 한 줄
    row: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    rowThumbWrap: { width: 84, height: 84, position: 'relative' },
    rowThumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    rowThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    playBadge: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: 30,
      height: 30,
      marginTop: -15,
      marginLeft: -15,
      borderRadius: 15,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: { flex: 1, justifyContent: 'center', gap: 3 },
    rowSource: { fontSize: 11, fontWeight: '700', color: colors.primary },
    rowTitle: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
    rowBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  })
}
