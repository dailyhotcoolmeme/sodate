import { useLocalSearchParams } from 'expo-router'
import React, { useState, useMemo, useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openOutlink } from '@/lib/outlink'
import { track } from '@/lib/analytics'
import { useAllReviews } from '@/hooks/useReviews'
import { getMyReviewIds } from '@/lib/reviewIdentity'
import { deleteReview } from '@/lib/reviews'
import ReviewCard from '@/components/ReviewCard'
import ReviewSheet, { type ReviewSheetInitial } from '@/components/ReviewSheet'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

type ReviewWithCompany = ReviewRow & { companies: { name: string; slug: string } | null }
type TabKey = 'user' | 'naver_blog' | 'instagram' | 'youtube' | 'mine'

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: 'user', label: '소개팅모아' },
  { key: 'naver_blog', label: '블로그' },
  { key: 'instagram', label: '인스타' },
  { key: 'youtube', label: '유튜브' },
]

const SOURCE_META: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  user: { label: '소개팅모아', icon: 'chatbubble-ellipses' },
  naver_blog: { label: '네이버 블로그', icon: 'logo-rss' },
  instagram: { label: '인스타그램', icon: 'logo-instagram' },
  youtube: { label: '유튜브', icon: 'logo-youtube' },
}

function cleanText(text: string): string {
  return (text || '')
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 업체별 후기가 섞여 있으므로 각 행에 '업체 배지'를 붙인다.
function AggReviewRow({
  review,
  styles,
  colors,
}: {
  review: ReviewWithCompany
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
}) {
  const meta = SOURCE_META[review.source as TabKey] ?? SOURCE_META.naver_blog
  const playable =
    review.source === 'youtube' ||
    (review.source === 'instagram' && /\/reel/.test(review.source_url ?? ''))
  const title = review.author_name ? cleanText(review.author_name) : ''
  const body = cleanText(review.content ?? '')
  const companyName = review.companies?.name ?? '기타'
  const postedAt = review.published_at
    ? new Date(review.published_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : ''

  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={review.source_url ? 0.7 : 1}
      disabled={!review.source_url}
      onPress={() => {
        track('review_click', { companyId: review.company_id, properties: { source: review.source } })
        if (review.source_url) openOutlink(review.source_url)
      }}
    >
      <View style={styles.thumbWrap}>
        {review.thumbnail_url ? (
          <Image source={{ uri: review.thumbnail_url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name={meta.icon} size={26} color={colors.textTertiary} />
          </View>
        )}
        {playable && (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={15} color="#fff" style={{ marginLeft: 2 }} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        {/* 출처(블로그/인스타/유튜브)는 탭으로 이미 정해지므로 배지 옆에 중복 표기하지 않음 */}
        <View style={styles.rowHeader}>
          <View style={styles.companyBadge}>
            <Text style={styles.companyBadgeText}>{companyName}</Text>
          </View>
        </View>
        {!!title && (
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        {/* 줄 수를 고정한다 — 본문 길이에 따라 아래 게시일 위치가 위아래로 흔들리던 문제. */}
        <Text style={styles.rowBody} numberOfLines={title ? 1 : 2}>
          {body}
        </Text>
        {/* 게시일은 행 맨 아래에 붙여 모든 행에서 같은 높이에 온다.
            인스타그램은 게시일을 얻을 수 없어 이 줄이 나오지 않는다. */}
        {!!postedAt && (
          <View style={styles.rowFooter}>
            <Text style={styles.rowDate}>{postedAt}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

export default function ReviewsScreen() {
  const insets = useSafeAreaInsets()
  const { reviews, loading, refetch } = useAllReviews(500)
  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)
  const refreshing = useRefreshIndicator(loading)
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  React.useEffect(() => {
    track('screen_view', { properties: { screen: 'reviews' } })
  }, [])

  // 내가 작성한 후기 식별용(기기 로컬)
  const [myReviewIds, setMyReviewIds] = useState<string[]>([])
  useEffect(() => {
    getMyReviewIds().then(setMyReviewIds)
  }, [])

  // 내 후기 수정/삭제
  const [sheetVisible, setSheetVisible] = useState(false)
  const [editTarget, setEditTarget] = useState<ReviewSheetInitial | null>(null)
  const [editCompanyId, setEditCompanyId] = useState<string>('')

  const openEdit = (r: ReviewRow) => {
    setEditTarget({ id: r.id, author_name: r.author_name, rating: r.rating, content: r.content, gender: r.gender })
    setEditCompanyId(r.company_id)
    setSheetVisible(true)
  }

  const handleDelete = async (r: ReviewRow) => {
    const res = await deleteReview(r.id)
    if ('error' in res) return
    setMyReviewIds((prev) => prev.filter((id) => id !== r.id))
    refetch()
  }

  const onEditDone = () => {
    setSheetVisible(false)
    refetch()
    getMyReviewIds().then(setMyReviewIds)
  }

  // 데이터 있는 소스만 탭으로
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of reviews) c[r.source] = (c[r.source] ?? 0) + 1
    return c
  }, [reviews])

  const myCount = useMemo(
    () => reviews.filter((r) => r.source === 'user' && myReviewIds.includes(r.id)).length,
    [reviews, myReviewIds]
  )

  // 소개팅모아 탭은 후기가 없어도 항상 표시(작성 유도). 나머지는 데이터 있을 때만. 내 후기는 항상 마지막.
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; count: number }[] = [
      { key: 'user', label: '소개팅모아', count: counts['user'] ?? 0 },
    ]
    for (const t of TAB_ORDER) {
      if (t.key === 'user') continue
      if ((counts[t.key] ?? 0) > 0) list.push({ ...t, count: counts[t.key] })
    }
    list.push({ key: 'mine', label: '내 후기', count: myCount })
    return list
  }, [counts, myCount])

  // 톱바 햄버거의 '내가 쓴 후기'는 이 화면의 '내 후기' 탭으로 바로 들어온다.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>()
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam === 'mine' ? 'mine' : 'user')
  const currentTab: TabKey = tabs.some((t) => t.key === activeTab)
    ? activeTab
    : tabs[0]?.key ?? 'naver_blog'

  // 정렬(모아보기 전용): 최신순(토글로 오래된순) / 업체순
  const [sortMode, setSortMode] = useState<'recent' | 'company'>('recent')
  const [recentDir, setRecentDir] = useState<'desc' | 'asc'>('desc')

  const filtered = useMemo(() => {
    const dateOf = (r: ReviewWithCompany) => new Date(r.published_at ?? r.created_at ?? 0).getTime()
    const list =
      currentTab === 'mine'
        ? reviews.filter((r) => r.source === 'user' && myReviewIds.includes(r.id))
        : reviews.filter((r) => r.source === currentTab)
    if (sortMode === 'company') {
      return list.sort((a, b) => {
        const c = (a.companies?.name ?? '').localeCompare(b.companies?.name ?? '', 'ko')
        return c !== 0 ? c : dateOf(b) - dateOf(a) // 같은 업체 내에선 최신순
      })
    }
    return list.sort((a, b) => (recentDir === 'desc' ? dateOf(b) - dateOf(a) : dateOf(a) - dateOf(b)))
  }, [reviews, currentTab, sortMode, recentDir, myReviewIds])

  const onPressRecent = () => {
    if (sortMode !== 'recent') setSortMode('recent')
    else setRecentDir((d) => (d === 'desc' ? 'asc' : 'desc'))
  }

  // 인스타그램은 게시일을 얻을 수 없어(로그인 필수) 실제로는 수집일 기준으로 정렬된다.
  // 그래서 이 탭에서만 '최신순'이 아니라 '수집일순'으로 표기한다. 방향은 화살표가 보여준다.
  // 업체순일 때는 비활성 칩이므로 방향 표기를 되돌린다(기존 동작 유지).
  const recentLabel =
    currentTab === 'instagram'
      ? '수집일순'
      : sortMode === 'recent' && recentDir === 'asc'
        ? '오래된순'
        : '최신순'

  return (
    <View style={styles.container}>
      <TopBar showBack />
      <View style={styles.header}>
        <Text style={styles.title}>후기 모아보기</Text>
        <Text style={styles.subtitle}>실제 참여자들의 솔직한 후기</Text>
      </View>

      {/* 소스 탭 — 가로 스크롤(한 줄, 스와이프) */}
      {tabs.length > 0 && (
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabRow}
          >
            {tabs.map((t) => {
              const active = t.key === currentTab
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => setActiveTab(t.key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                    {t.label}({t.count})
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )}

      {/* 정렬 (모아보기 전용): 최신순 토글 + 업체순 */}
      {tabs.length > 0 && (
        <View style={styles.sortRow}>
          <TouchableOpacity
            style={[styles.sortChip, sortMode === 'recent' && styles.sortChipActive]}
            onPress={onPressRecent}
            activeOpacity={0.7}
          >
            <Text style={[styles.sortChipText, sortMode === 'recent' && styles.sortChipTextActive]}>
              {recentLabel}
            </Text>
            {sortMode === 'recent' && (
              <Ionicons name={recentDir === 'asc' ? 'arrow-up' : 'arrow-down'} size={13} color={colors.primary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortChip, sortMode === 'company' && styles.sortChipActive]}
            onPress={() => setSortMode('company')}
            activeOpacity={0.7}
          >
            <Text style={[styles.sortChipText, sortMode === 'company' && styles.sortChipTextActive]}>
              업체순
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && reviews.length === 0 ? (
        <View style={styles.center}>
          <AppSpinner />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          {currentTab === 'mine' ? (
            <>
              <Ionicons name="create-outline" size={32} color={colors.textTertiary} />
              <Text style={styles.emptyText}>작성한 후기가 없어요</Text>
              <Text style={styles.emptySubText}>다녀온 소개팅에 후기를 남겨보세요!</Text>
            </>
          ) : currentTab === 'user' ? (
            <>
              <Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.textTertiary} />
              <Text style={styles.emptyText}>아직 소개팅모아 후기가 없어요</Text>
              <Text style={styles.emptySubText}>소개팅 참여 후 첫 후기를 남겨보세요!</Text>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>아직 후기가 없습니다</Text>
              <Text style={styles.emptySubText}>크롤링 후 업데이트됩니다</Text>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={colors.primary} />}
        >
          {currentTab === 'user' || currentTab === 'mine' ? (
            // 직접 작성 후기는 이미지가 없으니 상세페이지와 동일한 카드 구조로
            <View style={styles.userCards}>
              {filtered.map((r) => (
                <ReviewCard
                  key={r.id}
                  review={r}
                  hideSourceBadge
                  showCompany
                  // 내 후기 탭에서만 수정/삭제 노출
                  isMine={currentTab === 'mine'}
                  onEdit={currentTab === 'mine' ? openEdit : undefined}
                  onDelete={currentTab === 'mine' ? handleDelete : undefined}
                />
              ))}
            </View>
          ) : (
            filtered.map((r) => (
              <AggReviewRow key={r.id} review={r} styles={styles} colors={colors} />
            ))
          )}
        </ScrollView>
      )}

      {/* 내 후기 수정 시트 */}
      <ReviewSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        companyId={editCompanyId}
        initial={editTarget}
        onDone={onEditDone}
      />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    // 가로 스크롤 탭 바(한 줄, 스와이프)
    tabBar: {
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      marginBottom: 4,
    },
    tabRow: {
      flexDirection: 'row',
      paddingLeft: 16,
      paddingRight: 4, // 마지막 탭 marginRight(20)와 합쳐 우측 여백
    },
    tabBtn: {
      alignItems: 'center',
      paddingBottom: 10,
      marginRight: 20, // gap 대신(가로 ScrollView content 폭 오계산 방지)
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabLabel: { fontSize: 14, fontWeight: '600', color: colors.textTertiary },
    tabLabelActive: { color: colors.primary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
    emptySubText: { fontSize: 13, color: colors.textTertiary },
    // ReviewCard는 자체 marginHorizontal:16을 가지므로 ScrollView 좌우 패딩(16)을 상쇄
    userCards: { marginHorizontal: -16 },
    // 정렬 버튼 행 (텍스트 버튼, 박스 없음)
    // 게시일은 본문과 겹치지 않게 아래 오른쪽에 두어, 행이 이어질 때 같은 위치에 정렬된다.
    rowFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 'auto' },
    rowDate: { fontSize: 11, color: colors.textTertiary },
    sortRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, marginTop: 10, marginBottom: 2 },
    sortChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 4 },
    sortChipActive: {},
    sortChipText: { fontSize: 13, fontWeight: '600', color: colors.textTertiary },
    sortChipTextActive: { color: colors.primary, fontWeight: '800' },
    // 리스트 행
    row: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    thumbWrap: { width: 84, height: 84, position: 'relative' },
    thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
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
    // 썸네일과 같은 높이로 고정 → 모든 행의 높이가 같고, 바닥에 붙인 게시일도
    // 본문이 한 줄이든 두 줄이든 항상 같은 위치에 온다.
    rowText: { flex: 1, height: 84, gap: 4 },
    rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    companyBadge: {
      backgroundColor: colors.primary + '1F',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    companyBadgeText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
    sourceLabel: { fontSize: 11, fontWeight: '600', color: colors.textTertiary },
    rowTitle: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
    // flex:1 로 남은 공간을 차지해 게시일을 바닥까지 밀어낸다.
    rowBody: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  })
}
