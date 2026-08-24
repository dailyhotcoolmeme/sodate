import React, { useEffect, useMemo, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import AppSpinner from '@/components/AppSpinner'
import TopBar from '@/components/TopBar'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getMyReviewIds } from '@/lib/reviewIdentity'
import { deleteReview, fetchMyEventReviews } from '@/lib/reviews'
import { fetchMyPlaceReviews, deletePlaceReview } from '@/lib/placeReviews'
import ReviewCard from '@/components/ReviewCard'
import ReviewSheet, { type ReviewSheetInitial } from '@/components/ReviewSheet'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import type { ReviewRow } from '@/lib/supabase'
import { wideContent } from '@/constants/layout'

type Tab = 'dating' | 'socialing' | 'place'

const TABS: { key: Tab; label: string }[] = [
  { key: 'dating', label: '소개팅' },
  { key: 'socialing', label: '소셜링' },
  { key: 'place', label: '혼술바' },
]

/**
 * 내가 쓴 후기 — MY 전용 독립 화면(2026-08-24). 예전엔 후기 모아보기(reviews/index.tsx)
 * 안의 '내 후기' 탭 하나에 소개팅·소셜링·혼술바가 다 섞여 있었다. 여기서는 세 개를
 * 완전히 나눈다. 외부 크롤링 후기(블로그·인스타·유튜브) 모아보기는 이 화면과 무관 —
 * 4탭 개편으로 진입 경로(톱바 햄버거)가 없어져 당분간 숨겨둔다(오너 확인 2026-08-24).
 */
export default function MyReviewsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [tab, setTab] = useState<Tab>('dating')
  const [loading, setLoading] = useState(true)
  const [eventReviews, setEventReviews] = useState<Awaited<ReturnType<typeof fetchMyEventReviews>>>([])
  const [placeReviews, setPlaceReviews] = useState<any[]>([])

  const [sheetVisible, setSheetVisible] = useState(false)
  const [editTarget, setEditTarget] = useState<ReviewSheetInitial | null>(null)
  const [editCompanyId, setEditCompanyId] = useState<string>('')

  const load = async () => {
    const ids = await getMyReviewIds()
    const [events, places] = await Promise.all([
      fetchMyEventReviews(ids),
      fetchMyPlaceReviews(ids),
    ])
    setEventReviews(events)
    setPlaceReviews(places)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const dating = useMemo(() => eventReviews.filter((r) => r.event_type === 'dating'), [eventReviews])
  const socialing = useMemo(() => eventReviews.filter((r) => r.event_type === 'socialing'), [eventReviews])
  const list = tab === 'dating' ? dating : tab === 'socialing' ? socialing : placeReviews

  const openEdit = (r: ReviewRow) => {
    if ((r as any)._isPlace) { router.push(`/place/${(r as any)._placeId}` as never); return }
    setEditTarget({ id: r.id, author_name: r.author_name, rating: r.rating, content: r.content, gender: r.gender })
    setEditCompanyId(r.company_id)
    setSheetVisible(true)
  }
  const handleDelete = async (r: ReviewRow) => {
    if ((r as any)._isPlace) {
      const res = await deletePlaceReview(r.id)
      if ('error' in res) return
      load()
      return
    }
    const res = await deleteReview(r.id)
    if ('error' in res) return
    load()
  }
  const onEditDone = () => { setSheetVisible(false); load() }

  return (
    <View style={styles.container}>
      <TopBar showBack title="내가 쓴 후기" />
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabOn]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
              {t.label}({t.key === 'dating' ? dating.length : t.key === 'socialing' ? socialing.length : placeReviews.length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><AppSpinner /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="create-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>작성한 후기가 없어요</Text>
          <Text style={styles.emptySub}>
            다녀온 {tab === 'dating' ? '소개팅' : tab === 'socialing' ? '소셜링' : '혼술바'}에 후기를 남겨보세요!
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[wideContent, { paddingTop: 8, paddingBottom: insets.bottom + 20 }]}
        >
          <View style={styles.cards}>
            {list.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                hideSourceBadge
                showCompany
                isMine
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </View>
        </ScrollView>
      )}

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
    // 탭 — 즐겨찾기·최근 본 기록·알림 설정과 동일한 밑줄 탭 규격.
    tabs: {
      flexDirection: 'row', alignItems: 'flex-end', gap: 18,
      paddingHorizontal: 16, paddingTop: 8,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    tab: { paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    tabOn: { borderBottomColor: colors.primary },
    tabText: { fontSize: 15, fontWeight: '700', color: colors.textTertiary },
    tabTextOn: { color: colors.textPrimary, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    emptyText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
    emptySub: { fontSize: 13, color: colors.textTertiary },
    // ReviewCard는 자체 marginHorizontal:16을 가지므로 ScrollView 좌우 패딩과 겹치지 않게 상쇄
    cards: { marginHorizontal: -16 },
  })
}
