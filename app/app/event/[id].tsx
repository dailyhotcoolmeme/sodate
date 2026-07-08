import React, { useMemo, useEffect, useState, useCallback } from 'react'
import EventThumbnail from '@/components/EventThumbnail'
import { Ionicons } from '@expo/vector-icons'
import TopBar from '@/components/TopBar'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useEventDetail } from '@/hooks/useEventDetail'
import { useReviews } from '@/hooks/useReviews'
import { useFavorites } from '@/hooks/useFavorites'
import { openOutlink } from '@/lib/outlink'
import { useColors } from '@/hooks/useColors'
import { track } from '@/lib/analytics'
import DeadlineBadge from '@/components/DeadlineBadge'
import HashtagChips from '@/components/HashtagChips'
import ReviewSection from '@/components/ReviewSection'
import ReviewSheet, { type ReviewSheetInitial } from '@/components/ReviewSheet'
import { deleteReview, reportReview } from '@/lib/reviews'
import { getMyReviewIds } from '@/lib/reviewIdentity'
import type { ReviewRow } from '@/lib/supabase'
import AdBanner from '@/components/AdBanner'
import { daysUntil } from '@/lib/dday'
import PriceTierValue from '@/components/PriceTierValue'
import ThemeBadge from '@/components/ThemeBadge'
import { getThemeBadge } from '@/constants/themeBadges'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/_E\d+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 상세 설명: 크롤 시 줄바꿈이 공백으로 합쳐지므로, 불릿/섹션 기호(✅⛔🔺 등) 앞에서
// 줄을 나눠 마크다운형 리스트로 보여준다.
const _DESC_MARKERS = '✅|✔|☑|⛔|🔺|🔻|▶|►|●|◆|◼|■|👉|💠|✳|✴|⭐|❗|‼|🎁|🍷'
const _DESC_LEAD = new RegExp(`^((?:${_DESC_MARKERS})+|-|·|\\d+[.)])\\s*`, 'u')
// 날짜 나열(예: "7.10(금) 오후 8시 로테이션 소개팅 C")은 대부분 지난 회차라 지저분함 → 제거.
// 날짜+시각이 반드시 있어야 매칭되므로 "로테이션 소개팅 A 남:95~" 같은 조건 설명은 보존됨.
const _SCHED_TUPLE =
  /\d{1,2}\s*\.\s*\d{1,2}\s*(?:\([일월화수목금토]\))?\s*(?:오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?(?:\s*(?:로테이션\s*)?소개팅\s*[A-Da-d]?)?/gu

function descLines(raw: string): string[] {
  let t = (raw || '').replace(/_E\d+$/i, '').replace(/️/g, '')
  // 날짜 나열 제거
  t = t.replace(_SCHED_TUPLE, ' ')
  // 불릿 기호 묶음 앞에서 줄바꿈
  t = t.replace(new RegExp(`\\s*((?:${_DESC_MARKERS})+)`, 'gu'), '\n$1')
  // " - " 서브 불릿
  t = t.replace(/\s+-\s+/g, '\n- ')
  // 문장 끝(마침표/느낌표/물음표 + 공백)에서 줄바꿈 — 기호 없는 문장형 설명 대응
  t = t.replace(/([가-힣A-Za-z0-9)\]」』】])([.!?]+)\s+/g, '$1$2\n')
  // 번호 목록 "N." "N)" 앞에서 줄바꿈
  t = t.replace(/\s+(\d{1,2}[.)]\s)/g, '\n$1')
  const onlyMarker = new RegExp(`^(?:${_DESC_MARKERS}|\\s)+$`, 'u')
  return t
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && !onlyMarker.test(s))
}

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
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backBtn: { paddingVertical: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
    backText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    imageContainer: { position: 'relative' },
    image: { width: '100%', aspectRatio: 4 / 3 },
    imagePlaceholder: {
      width: '100%',
      aspectRatio: 4 / 3,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imagePlaceholderText: { fontSize: 64 },
    content: { padding: 20 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    company: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '600',
    },
    heartBtn: {
      padding: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heartBtnActive: {},
    heartIcon: { fontSize: 20, color: colors.textTertiary },
    heartIconActive: { color: '#FF6B9D' },
    title: {
      fontSize: 22,
      color: colors.textPrimary,
      fontWeight: '800',
      lineHeight: 30,
      marginBottom: 20,
    },
    infoCard: {
      backgroundColor: colors.surface,
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
      color: colors.textTertiary,
      width: 56,
      fontWeight: '500',
    },
    infoValue: {
      flex: 1,
      fontSize: 14,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    hashtagRow: { marginTop: -14, marginBottom: 16 },
    hashtagRowWithTheme: { marginTop: 0 },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: -10,
      marginBottom: 12,
    },
    themeNote: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    tagsSection: { marginBottom: 20 },
    sectionLabel: {
      fontSize: 13,
      color: colors.textTertiary,
      fontWeight: '600',
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tags: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    descSection: { marginBottom: 20 },
    description: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    descPara: { marginBottom: 8 },
    // 기호로 시작한 줄: 줄바꿈 시 텍스트 시작점에 정렬(행잉 인덴트)
    descRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: 7 },
    descSub: { paddingLeft: 14 },
    descBullet: { fontSize: 14, lineHeight: 22, color: colors.textSecondary },
    descRowText: { flex: 1, fontSize: 14, lineHeight: 22, color: colors.textSecondary },
    descMoreBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      marginTop: 8,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    descMoreText: { fontSize: 13, fontWeight: '700', color: colors.primary },
    ctaBtn: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 12,
    },
    ctaBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
    ctaBtnClosed: { backgroundColor: '#e5e7eb' },
    ctaBtnClosedText: { color: '#9ca3af', fontWeight: '700', fontSize: 16 },
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
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 12,
    },
    closedBadgeText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 1,
    },
    participantBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 14,
      paddingVertical: 13,
      marginBottom: 28,
      borderWidth: 1.5,
      borderColor: colors.secondary,
      backgroundColor: '#9B59F511',
    },
    participantBtnText: {
      color: colors.secondary,
      fontWeight: '700',
      fontSize: 15,
    },
    reviewsSection: { gap: 0, marginTop: 14 },
    reviewsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    moreLink: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '600',
    },
    writeInline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    writeInlineText: {
      color: colors.primary,
      fontWeight: '700',
      fontSize: 14,
    },
    emptyReviews: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
    },
    emptyReviewsText: {
      fontSize: 13,
      color: colors.textTertiary,
    },
    reviewsList: { gap: 0, marginHorizontal: -20 },
    errorText: { color: colors.error, fontSize: 15 },
    backLink: { color: colors.primary, fontSize: 14 },
  }), [colors])

  const companyId = event?.companies?.id ?? null
  // 한 업체 후기 전체를 가져와야 탭별(블로그/인스타/유튜브) 개수·목록이 잘리지 않음(업체 최대 ~164건)
  const { reviews, loading: reviewsLoading, refetch: refetchReviews } = useReviews(companyId, 300)
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  // 후기 작성/수정 시트 + 내 후기 식별
  const [sheetVisible, setSheetVisible] = useState(false)
  const [editTarget, setEditTarget] = useState<ReviewSheetInitial | null>(null)
  const [myReviewIds, setMyReviewIds] = useState<string[]>([])
  const [descExpanded, setDescExpanded] = useState(false)

  const loadMyReviewIds = useCallback(() => {
    getMyReviewIds().then(setMyReviewIds)
  }, [])

  useEffect(() => {
    loadMyReviewIds()
  }, [loadMyReviewIds])

  const openWrite = () => {
    setEditTarget(null)
    setSheetVisible(true)
  }

  const openEdit = (review: ReviewRow) => {
    setEditTarget({ id: review.id, author_name: review.author_name, rating: review.rating, content: review.content })
    setSheetVisible(true)
  }

  const handleSheetDone = () => {
    loadMyReviewIds()
    refetchReviews()
  }

  const handleDelete = async (review: ReviewRow) => {
    const result = await deleteReview(review.id)
    if ('error' in result) {
      Alert.alert('삭제 실패', result.error)
      return
    }
    loadMyReviewIds()
    refetchReviews()
  }

  const handleReport = (review: ReviewRow) => {
    Alert.alert(
      '후기 신고',
      '이 후기를 신고할까요? 부적절한 내용은 검토 후 조치됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '신고',
          style: 'destructive',
          onPress: async () => {
            const result = await reportReview(review.id)
            if ('error' in result) {
              Alert.alert('신고 실패', result.error)
              return
            }
            Alert.alert('신고되었습니다', result.already ? '이미 신고한 후기입니다.' : '검토 후 조치하겠습니다.')
          },
        },
      ]
    )
  }

  useEffect(() => {
    if (event) {
      track('event_view', { eventId: event.id, companyId: event.company_id })
    }
  }, [event?.id])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
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
          <Text style={styles.backLink}>돌아가기</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const daysLeft = daysUntil(event.event_date)

  return (
    <View style={styles.screen}>
      <TopBar showBack />
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {/* 썸네일 */}
      <View style={styles.imageContainer}>
        <EventThumbnail
          url={event.thumbnail_urls?.[0]}
          companyName={event.companies?.name}
          region={event.location_region}
          style={styles.image}
          size="detail"
        />
        {daysLeft <= 3 && daysLeft >= 0 && (
          <DeadlineBadge daysLeft={daysLeft} />
        )}
        {/* 마감 — 흐림 + 중앙 배지 */}
        {event.is_closed && (
          <View style={styles.closedOverlay} pointerEvents="none">
            <View style={styles.closedBadge}>
              <Text style={styles.closedBadgeText}>마감</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.content}>
        {/* 업체명 + 하트 */}
        <View style={styles.titleRow}>
          {event.companies && (
            <TouchableOpacity
              onPress={() => router.push(`/company/${event.companies!.id}`)}
              style={{ flex: 1 }}
            >
              <Text style={styles.company}>{event.companies.name} ›</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.heartBtn, favoriteIds.has(event.id) && styles.heartBtnActive]}
            onPress={() => {
              track(favoriteIds.has(event.id) ? 'event_favorite_remove' : 'event_favorite_add', {
                eventId: event.id, companyId: event.company_id,
                properties: { from_screen: 'detail' },
              })
              toggleFavorite(event.id)
            }}
          >
            <Ionicons
              name="heart"
              size={20}
              color={favoriteIds.has(event.id) ? '#FF6B9D' : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        {/* 제목 */}
        <Text style={styles.title}>{cleanText(event.title)}</Text>

        {/* 테마 배지 + 한줄 설명 (있을 때만) */}
        {getThemeBadge(event.theme) && (
          <View style={styles.themeRow}>
            <ThemeBadge theme={event.theme} size="md" />
            <Text style={styles.themeNote}>{getThemeBadge(event.theme)!.note}</Text>
          </View>
        )}

        {/* 해시태그 배지 (제목 바로 아래) — title 하단 여백을 끌어올려 붙임 */}
        <View style={[styles.hashtagRow, getThemeBadge(event.theme) && styles.hashtagRowWithTheme]}>
          <HashtagChips hashtags={event.hashtags} size="md" max={4} />
        </View>

        {/* 기본 정보 */}
        <View style={styles.infoCard}>
          <InfoRow label="일시" value={formatDate(event.event_date)} styles={styles} />
          <InfoRow label="지역" value={event.location_region} styles={styles} />
          {(() => {
            const detail = event.price_detail
            const hasM = event.price_male != null || !!detail?.male || !!event.age_male
            const hasF = event.price_female != null || !!detail?.female || !!event.age_female
            return (
              <>
                {hasM && (
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: '#3B82F6', fontWeight: '700' }]}>남성</Text>
                    <View style={styles.infoValue}><PriceTierValue detail={detail?.male} price={event.price_male} age={event.age_male} /></View>
                  </View>
                )}
                {hasF && (
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.primary, fontWeight: '700' }]}>여성</Text>
                    <View style={styles.infoValue}><PriceTierValue detail={detail?.female} price={event.price_female} age={event.age_female} /></View>
                  </View>
                )}
              </>
            )
          })()}
        </View>


        {/* 설명 — 날짜 나열만 있던 경우 descLines가 비므로 섹션 자체를 숨김. 길면 더보기로 접힘 */}
        {(() => {
          const descItems = event.description ? descLines(event.description) : []
          if (descItems.length === 0) return null
          const COLLAPSE = 6
          const collapsible = descItems.length > COLLAPSE
          const shown = descExpanded || !collapsible ? descItems : descItems.slice(0, COLLAPSE)
          return (
            <View style={styles.descSection}>
              <Text style={styles.sectionLabel}>상세 설명</Text>
              {shown.map((line, i) => {
                const m = line.match(_DESC_LEAD)
                if (m) {
                  const marker = m[1] === '-' ? '·' : m[1]
                  const rest = line.slice(m[0].length)
                  const sub = m[1] === '-'
                  return (
                    <View key={i} style={[styles.descRow, sub && styles.descSub]}>
                      <Text style={styles.descBullet}>{marker}</Text>
                      <Text style={styles.descRowText}>{rest}</Text>
                    </View>
                  )
                }
                return (
                  <Text key={i} style={[styles.description, styles.descPara]}>{line}</Text>
                )
              })}
              {collapsible && (
                <TouchableOpacity
                  style={styles.descMoreBtn}
                  onPress={() => setDescExpanded((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.descMoreText}>{descExpanded ? '접기' : '더보기'}</Text>
                  <Ionicons
                    name={descExpanded ? 'chevron-up' : 'chevron-down'}
                    size={15}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>
          )
        })()}

        {/* 신청 버튼 위 광고 (CTA와 구분되는 외곽선형 + '광고' 배지) */}
        <AdBanner />

        {/* 신청 버튼 (마감 시 회색 비활성) */}
        {event.is_closed ? (
          <View style={[styles.ctaBtn, styles.ctaBtnClosed]}>
            <Text style={styles.ctaBtnClosedText}>신청 마감</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => {
              track('event_apply_click', { eventId: event.id, companyId: event.company_id })
              openOutlink(event.source_url)
            }}
          >
            <Text style={styles.ctaBtnText}>신청하기 ›</Text>
          </TouchableOpacity>
        )}

        {/* 업체 후기 섹션 */}
        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>
              {event.companies?.name ?? '업체'} 후기
            </Text>
            {/* 후기 작성 — 제목 라인 오른쪽 끝에 연필+글자만(박스 없음) */}
            {companyId && (
              <TouchableOpacity style={styles.writeInline} onPress={openWrite} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name="create-outline" size={16} color={colors.primary} />
                <Text style={styles.writeInlineText}>후기 작성</Text>
              </TouchableOpacity>
            )}
          </View>

          {reviewsLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : (
            <ReviewSection
              reviews={reviews}
              myReviewIds={myReviewIds}
              onEdit={openEdit}
              onDelete={handleDelete}
              onReport={handleReport}
            />
          )}
        </View>

        <View style={{ height: 40 }} />
      </View>
    </ScrollView>
    {companyId && (
      <ReviewSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        companyId={companyId}
        initial={editTarget}
        onDone={handleSheetDone}
      />
    )}
    </View>
  )
}

function InfoRow({ label, value, styles }: { label: string; value: string; styles: any }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}
