import React, { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import AppSpinner from '@/components/AppSpinner'
import EventThumbnail from '@/components/EventThumbnail'
import PartnerBadge from '@/components/PartnerBadge'
import PartnerNotice from '@/components/PartnerNotice'
import { isPartnerCompany } from '@/lib/partner'
import { Ionicons } from '@expo/vector-icons'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { confirmFavorite } from '@/lib/confirmToggle'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
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
import { addRecentView } from '@/lib/recentViews'
import DeadlineBadge from '@/components/DeadlineBadge'
import HashtagChips from '@/components/HashtagChips'
import ReviewSection from '@/components/ReviewSection'
import ReviewSheet, { type ReviewSheetInitial } from '@/components/ReviewSheet'
import ReportSheet from '@/components/ReportSheet'
import { deleteReview } from '@/lib/reviews'
import { getMyReviewIds } from '@/lib/reviewIdentity'
import type { ReviewRow } from '@/lib/supabase'
import AdBanner from '@/components/AdBanner'
import { daysUntil } from '@/lib/dday'
import PriceTierValue from '@/components/PriceTierValue'
import { groupForCategory } from '@/constants/socialingCategories'
import ThemeBadge from '@/components/ThemeBadge'
import { getThemeBadge } from '@/constants/themeBadges'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

function cleanText(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F000}-\u{1FFFF}]|\u200d/gu, '')
    .replace(/_E\d+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 상세 설명은 업체/일정별로 등록한 이미지 유형(company_image_types)으로만 표시한다.
// 전체 폭으로 채우고 원본 비율대로 높이를 맞춘다.
// 나눠 캡처한 이미지가 한 장처럼 보이도록 위아래로 딱 붙임(간격 0).
// 바깥 모서리만 라운드: 첫 장 위쪽, 마지막 장 아래쪽 (다른 카드와 동일한 12).
const DESC_IMG_RADIUS = 12
// 상세설명(이미지)이 너무 길어 강제로 접어두는 높이. 이 높이 넘으면 '더보기' 노출.
const DESC_COLLAPSED_H = 460
function DescImage({ uri, first, last }: { uri: string; first: boolean; last: boolean }) {
  const [ratio, setRatio] = useState<number | null>(null)
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      transition={150}
      cachePolicy="memory-disk"
      onLoad={(e) => {
        const w = e?.source?.width
        const h = e?.source?.height
        if (w && h) setRatio(w / h)
      }}
      style={{
        width: '100%',
        aspectRatio: ratio ?? 1.4,
        borderTopLeftRadius: first ? DESC_IMG_RADIUS : 0,
        borderTopRightRadius: first ? DESC_IMG_RADIUS : 0,
        borderBottomLeftRadius: last ? DESC_IMG_RADIUS : 0,
        borderBottomRightRadius: last ? DESC_IMG_RADIUS : 0,
      }}
    />
  )
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
  const { event, loading, error, refetch } = useEventDetail(id)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
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
    // 히어로 높이 축소(1:1→4:3) — 진입 시 광고배너가 바로 보이게. cover라 왜곡 없이 크롭만.
    image: { width: '100%', aspectRatio: 4 / 3 },
    imagePlaceholder: {
      width: '100%',
      aspectRatio: 4 / 3,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    imagePlaceholderText: { fontSize: 64 },
    // 좌측 시작 위치만 다른 페이지들과 통일(16px). 위쪽 20은 그대로 — 여긴 TopBar 바로 아래가
    // 아니라 히어로 이미지 바로 아래라 "TopBar~제목 간격" 비교 대상이 아니다(2026-08-12).
    content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4, // 업체명→제목 간격 축소
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
    // 딱지와 제목을 한 줄에. 제목이 길어지면 딱지가 아니라 제목이 줄바꿈된다.
    // ⚠️ 위쪽 titleRow(업체명+하트)와 다른 줄이다 — 이름을 겹치게 쓰면 뒤에 선언한 쪽이
    //    앞을 통째로 덮어써서 업체명 줄 간격이 조용히 바뀐다.
    partnerTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 14 },
    titleText: { flex: 1, marginBottom: 0 },
    title: {
      fontSize: 22,
      color: colors.textPrimary,
      fontWeight: '800',
      lineHeight: 30,
      marginBottom: 14, // 제목→해시태그 간격 축소(해시태그 marginTop -14와 함께)
    },
    infoCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 2, // 일시·지역·남성·여성 줄간격 = 피드 리스트 내부 텍스트(info gap:2) 기준으로 통일
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
    hashtagRow: { marginTop: -14, marginBottom: 8 }, // 해시태그→정보박스 간격 축소
    hashtagRowWithTheme: { marginTop: 0 },
    themeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: -10,
      marginBottom: 8,
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
    // 소셜링 전용 — 카테고리 배지(업체명 자리), 참여현황, 설명 텍스트(줄바꿈 보존)
    socCatBadge: { alignSelf: 'flex-start', backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 },
    socCatBadgeText: { fontSize: 12, fontWeight: '800', color: colors.primary },
    socPartText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    socDescText: { fontSize: 14.5, color: colors.textPrimary, lineHeight: 23 },
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
  // 당겨서 새로고침 — 일정 정보와 후기를 함께 새로 받는다
  const refreshAll = useCallback(() => { refetch(); refetchReviews() }, [refetch, refetchReviews])
  const { refreshing, onRefresh } = useRefreshIndicator(loading || reviewsLoading, refreshAll)
  const { favoriteIds, toggle: toggleFavorite } = useFavorites()

  // 후기 작성/수정 시트 + 내 후기 식별
  const [sheetVisible, setSheetVisible] = useState(false)
  const [editTarget, setEditTarget] = useState<ReviewSheetInitial | null>(null)
  const [myReviewIds, setMyReviewIds] = useState<string[]>([])
  const [reportTarget, setReportTarget] = useState<string | null>(null)

  // 제휴 혜택 팝업 — 화면에 들어오면 한 번 뜬다(2026-09-02 오너 지시).
  // ⚠️ 조건을 event 로딩 완료 뒤로 두는 이유: 혜택 문구가 조회 결과에 들어 있어서,
  //    로딩 중에 띄우면 빈 팝업이 떴다가 글자가 나중에 채워진다. 스피너 위에 뜨는
  //    팝업은 그 자체로 고장처럼 보이기도 한다.
  // '다시 보지 않기'는 두지 않는다(오너 지시). 대신 shownRef 로 이 화면에 머무는
  // 동안에는 다시 뜨지 않게 한다 — 스크롤·리렌더마다 뜨면 못 쓴다.
  const [partnerNotice, setPartnerNotice] = useState(false)
  const partnerShownRef = useRef(false)
  const isPartner = isPartnerCompany(event?.companies)
  useEffect(() => {
    if (!event || !isPartner || partnerShownRef.current) return
    partnerShownRef.current = true
    // 제휴 업체에 "모잇 할인 안내를 몇 명이 봤다"고 보여줄 숫자(2026-09-03)
    track('partner_notice_view', {
      companyId: event.company_id,
      menu: event.event_type === 'socialing' ? 'socialing' : 'dating',
      properties: { company: event.companies?.name ?? null },
    })
    setPartnerNotice(true)
  }, [event, isPartner])
  // 상세설명 접기/펼치기 (기본 접힘) + 실제 콘텐츠 높이(더보기 노출 판단)
  const [descExpanded, setDescExpanded] = useState(false)
  const [descContentH, setDescContentH] = useState(0)
  // 참석자 명단 이미지(파이낸스라운지 등 노션 기반 업체만 값이 있음) 접기/펼치기
  const [attendeeExpanded, setAttendeeExpanded] = useState(false)
  const [attendeeContentH, setAttendeeContentH] = useState(0)

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
    setEditTarget({ id: review.id, author_name: review.author_name, rating: review.rating, content: review.content, gender: review.gender })
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

  // 신고 사유 선택 바텀시트 열기
  const handleReport = (review: ReviewRow) => {
    setReportTarget(review.id)
  }

  useEffect(() => {
    if (event) {
      // 메뉴를 같이 남긴다 — 일정이 지워지면 event_id 로 되짚을 수 없다(2026-09-03).
      const menu = event.event_type === 'socialing' ? 'socialing' : 'dating'
      track('event_view', { eventId: event.id, companyId: event.company_id, menu })
      // 제목·업체명 사본 — 일정이 정리된 뒤에도 뭐가 인기였는지 알 수 있게.
      track('item_view', { eventId: event.id, companyId: event.company_id, menu,
        properties: { title: event.title, company: event.companies?.name ?? null } })
      // MY '최근 본 기록' 기록(2026-08-21, kind 세분화 2026-08-24) — 로컬 저장, 무해.
      addRecentView({
        kind: event.event_type === 'socialing' ? 'socialing' : 'dating',
        id: event.id, title: event.title,
        sub: [event.companies?.name, event.location_region].filter(Boolean).join(' · ') || undefined,
      })
    }
  }, [event?.id])

  if (loading && !event) {
    return (
      <View style={styles.center}>
        <AppSpinner />
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

  // 신청하기 버튼 — 상세설명 위/아래 두 곳에서 재사용.
  // 마감이어도 눌러서 업체 사이트로 갈 수 있어야 한다(오너 확정, 2026-07-29) —
  // 참가자가 계속 바뀌어 자리가 다시 나므로, 앱에서 막아버리면 신청 기회를 잃는다.
  // 회색 '신청 마감' 모양은 그대로 두고 눌리기만 하게 한다.
  const renderCta = () => (
    <TouchableOpacity
      style={[styles.ctaBtn, event.is_closed && styles.ctaBtnClosed]}
      onPress={() => {
        const menu = event.event_type === 'socialing' ? 'socialing' : 'dating'
        track('event_apply_click', { eventId: event.id, companyId: event.company_id, menu })
        track('outlink_click', { eventId: event.id, companyId: event.company_id, menu, properties: { kind: 'apply' } })
        openOutlink(event.source_url)
      }}
    >
      <Text style={event.is_closed ? styles.ctaBtnClosedText : styles.ctaBtnText}>
        {event.is_closed ? '신청 마감' : '신청하기 ›'}
      </Text>
    </TouchableOpacity>
  )

  // 소셜링(2026-08-21) — 같은 상세화면에서 세 곳만 갈아끼운다: 업체명→카테고리 배지,
  // 남/여 가격→참여현황, 상세이미지 스택→설명 텍스트(줄바꿈 보존). 나머지는 공통.
  const isSocialing = event.event_type === 'socialing'
  const socGroup = isSocialing ? groupForCategory(event.socialing_category) : undefined
  const ps = event.participant_stats

  return (
    <View style={styles.screen}>
      {/* ⚠️(2026-08-26) 이 상세화면은 소개팅·소셜링 이벤트가 같이 쓰는 화면이라, 톱바
          로고를 눌렀을 때 무조건 소개팅 홈(/)으로 보내던 기본 동작(TopBar 자체 로직,
          segment='event'|'board' 2분법이라 5탭 개편 이전 그대로였다)이 소셜링에서 열었을
          때도 소개팅으로 튕겨서 흐름이 끊겼다(오너 지시: "상세페이지에서 톱바 아이콘
          누르면 해당 메뉴들의 서브홈 화면으로 보내라"). 실제로 어느 쪽 이벤트인지
          아는 이 화면이 직접 목적지를 정해준다. */}
      <TopBar showBack onLogoPress={() => router.replace(isSocialing ? '/socialing' : '/')} />
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
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
        {/* 업체명 + 하트 (소셜링은 업체명 대신 카테고리 배지) */}
        <View style={styles.titleRow}>
          {isSocialing ? (
            <View style={{ flex: 1 }}>
              {socGroup && (
                <View style={styles.socCatBadge}>
                  <Text style={styles.socCatBadgeText}>{socGroup.label}</Text>
                </View>
              )}
            </View>
          ) : event.companies ? (
            <TouchableOpacity
              onPress={() => router.push(`/company/${event.companies!.id}`)}
              style={{ flex: 1 }}
            >
              <Text style={styles.company}>{event.companies.name} ›</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.heartBtn, favoriteIds.has(event.id) && styles.heartBtnActive]}
            onPress={() => confirmFavorite(favoriteIds.has(event.id), () => {
              track(favoriteIds.has(event.id) ? 'event_favorite_remove' : 'event_favorite_add', {
                eventId: event.id, companyId: event.company_id,
                properties: { from_screen: 'detail' },
              })
              toggleFavorite(event.id)
            })}
          >
            <Ionicons
              name="bookmark"
              size={20}
              color={favoriteIds.has(event.id) ? '#FF6B9D' : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        {/* 제목 — 제휴업체면 딱지가 제목 앞에 붙는다(카드와 같은 규칙, 2026-09-02).
            제목이 두 줄 이상이면 딱지는 첫 줄에 맞춰 위로 붙는다(alignItems flex-start). */}
        <View style={styles.partnerTitleRow}>
          {isPartnerCompany(event.companies) && <PartnerBadge size="md" />}
          <Text style={[styles.title, styles.titleText]}>{cleanText(event.title)}</Text>
        </View>

        {/* 테마 배지 + 한줄 설명 (있을 때만) */}
        {getThemeBadge(event.theme) && (
          <View style={styles.themeRow}>
            <ThemeBadge theme={event.theme} size="md" />
            <Text style={styles.themeNote}>{getThemeBadge(event.theme)!.note}</Text>
          </View>
        )}

        {/* 해시태그 배지 (제목 바로 아래) — title 하단 여백을 끌어올려 붙임 */}
        <View style={[styles.hashtagRow, getThemeBadge(event.theme) && styles.hashtagRowWithTheme]}>
          <HashtagChips hashtags={event.hashtags} size="md" />
        </View>

        {/* 기본 정보 */}
        <View style={styles.infoCard}>
          <InfoRow label="일시" value={formatDate(event.event_date)} styles={styles} />
          <InfoRow label="지역" value={event.location_region} styles={styles} />
          {isSocialing ? (
            // 소셜링 참여현황 — 성비(문토) > 총정원(동행) > 대기(트레바리). 가격은 별도 행.
            <>
              {event.price_male != null && (
                <InfoRow label="가격" value={`${event.price_male.toLocaleString()}원`} styles={styles} />
              )}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>참여</Text>
                <View style={styles.infoValue}>
                  {(ps?.male_count != null || ps?.female_count != null) ? (
                    <Text style={styles.socPartText}>
                      {ps?.male_count != null && <Text style={{ color: '#3B82F6', fontWeight: '700' }}>남 {ps.male_count}</Text>}
                      {ps?.male_count != null && ps?.female_count != null && '  '}
                      {ps?.female_count != null && <Text style={{ color: colors.primary, fontWeight: '700' }}>여 {ps.female_count}</Text>}
                    </Text>
                  ) : ps?.total_capacity != null ? (
                    <Text style={styles.socPartText}>정원 {ps.total_capacity}명 중 <Text style={{ color: colors.primary, fontWeight: '700' }}>{ps.total_count ?? 0}명</Text> 참여</Text>
                  ) : (
                    <Text style={[styles.socPartText, { color: colors.textTertiary }]}>신청 · 대기 가능</Text>
                  )}
                </View>
              </View>
            </>
          ) : (() => {
            const detail = event.price_detail
            const hasM = event.price_male != null || !!detail?.male || !!event.age_male
            const hasF = event.price_female != null || !!detail?.female || !!event.age_female
            const soldM = event.seats_left_male != null && event.seats_left_male <= 0
            const soldF = event.seats_left_female != null && event.seats_left_female <= 0
            return (
              <>
                {hasM && (
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: '#3B82F6', fontWeight: '700' }]}>남성</Text>
                    <View style={styles.infoValue}><PriceTierValue detail={detail?.male} price={event.price_male} age={event.age_male} soldout={soldM} /></View>
                  </View>
                )}
                {hasF && (
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.primary, fontWeight: '700' }]}>여성</Text>
                    <View style={styles.infoValue}><PriceTierValue detail={detail?.female} price={event.price_female} age={event.age_female} soldout={soldF} /></View>
                  </View>
                )}
              </>
            )
          })()}
        </View>


        {/* 참석자 명단 이미지 — 크롤러가 원본(노션 등)에서 R2로 재호스팅한 값이 있을 때만 노출 */}
        {event.attendee_image_url && (
          <View style={styles.descSection}>
            <Text style={styles.sectionLabel}>참석자 현황</Text>
            <View style={{ maxHeight: attendeeExpanded ? undefined : DESC_COLLAPSED_H, overflow: 'hidden' }}>
              <View onLayout={(e) => setAttendeeContentH(e.nativeEvent.layout.height)}>
                <DescImage uri={event.attendee_image_url} first last />
              </View>
            </View>
            {attendeeContentH > DESC_COLLAPSED_H + 40 && (
              <TouchableOpacity
                style={styles.descMoreBtn}
                onPress={() => setAttendeeExpanded((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.descMoreText}>{attendeeExpanded ? '접기' : '참석자 현황 더보기'}</Text>
                <Ionicons name={attendeeExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 소셜링 상세 설명 — 크롤 텍스트를 줄바꿈 보존해 그대로 표시(소개팅과 달리 이미지 스택 없음).
            설명이 없는 소스(트레바리)는 섹션 자체를 숨긴다. */}
        {isSocialing && !!event.description && (
          <View style={styles.descSection}>
            {renderCta()}
            <Text style={styles.sectionLabel}>모임 소개</Text>
            {/* 소셜링 설명은 창작 표현(저작권) → 앞부분 15줄만 발췌하고, '더보기'는 펼치지 않고
                업체 원문 페이지로 이동시킨다(전체 복제 회피 + 정당 인용). */}
            <Text style={styles.socDescText} numberOfLines={15}>{event.description}</Text>
            {(event.description.length > 260 || (event.description.match(/\n/g)?.length ?? 0) >= 14) && (
              <TouchableOpacity style={styles.descMoreBtn} onPress={() => openOutlink(event.source_url)} activeOpacity={0.7}>
                <Text style={styles.descMoreText}>더보기</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 상세 설명 — 업체/일정별로 등록된 이미지 유형으로만 표시. 이미지 없으면 섹션 숨김(크롤 텍스트는 미노출) */}
        {!isSocialing && event.descImages && event.descImages.length > 0 && (
          <View style={styles.descSection}>
            {/* 상세 이미지가 길어 하단 광고가 안 보일 수 있어 설명 시작 위에도 광고 노출 */}
            <AdBanner variant="text" />
            {/* 상세설명이 길어 하단 신청버튼을 찾기 어려워, 설명 위에도 신청 버튼 배치 */}
            {renderCta()}
            <Text style={styles.sectionLabel}>상세 설명</Text>
            {/* 긴 상세이미지는 기본 접힘 → '더보기'로 펼침 */}
            <View style={{ maxHeight: descExpanded ? undefined : DESC_COLLAPSED_H, overflow: 'hidden' }}>
              <View onLayout={(e) => setDescContentH(e.nativeEvent.layout.height)}>
                {event.descImages.map((uri, i) => (
                  <DescImage
                    key={`${uri}-${i}`}
                    uri={uri}
                    first={i === 0}
                    last={i === event.descImages!.length - 1}
                  />
                ))}
              </View>
            </View>
            {descContentH > DESC_COLLAPSED_H + 40 && (
              <TouchableOpacity
                style={styles.descMoreBtn}
                onPress={() => setDescExpanded((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.descMoreText}>{descExpanded ? '접기' : '상세설명 더보기'}</Text>
                <Ionicons name={descExpanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 신청 버튼 위 광고 (CTA와 구분되는 외곽선형 + '광고' 배지) */}
        <AdBanner variant="thumb" />

        {/* 신청 버튼 (마감 시 회색 비활성) */}
        {renderCta()}

        {/* 후기 섹션 — 업체명 붙이지 않고 "후기"로 통일(오너 지시 2026-08-24, "문토 후기"·"프립 후기" 등 제각각이던 것) */}
        <View style={styles.reviewsSection}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>후기</Text>
            {/* 후기 작성 — 제목 라인 오른쪽 끝에 연필+글자만(박스 없음) */}
            {companyId && (
              <TouchableOpacity style={styles.writeInline} onPress={openWrite} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name="create-outline" size={16} color={colors.primary} />
                <Text style={styles.writeInlineText}>후기 작성</Text>
              </TouchableOpacity>
            )}
          </View>

          {reviewsLoading ? (
            <View style={{ alignItems: 'center', marginVertical: 16 }}><AppSpinner size={32} /></View>
          ) : (
            <ReviewSection
              // 소셜링은 자체 후기만 — 외부 크롤링 후기(블로그·인스타·유튜브)는 소개팅
              // 업체 위주로 모은 것이라 소셜링과 안 맞는다(오너 지시 2026-08-24: "빼기로 했잖아").
              reviews={isSocialing ? reviews.filter((r) => r.source === 'user') : reviews}
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
        eventId={id}
        initial={editTarget}
        onDone={handleSheetDone}
      />
    )}
    <ReportSheet
      visible={reportTarget !== null}
      reviewId={reportTarget}
      onClose={() => setReportTarget(null)}
      onReported={(already) => {
        Alert.alert('신고되었습니다', already ? '이미 신고한 후기입니다.' : '검토 후 조치하겠습니다.')
      }}
    />
    <PartnerNotice
      visible={partnerNotice}
      kind="event"
      benefit={event.companies?.partner_benefit}
      onClose={() => setPartnerNotice(false)}
    />
    <BottomNav current={isSocialing ? 'socialing' : 'event'} route={`/event/${id}`} />
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
