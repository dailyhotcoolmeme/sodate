import React, { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { type PlaceRow, openStatus, categoryCover, topConveniences } from '@/lib/places'
import { formatDistanceKm } from '@/lib/nearby'

/**
 * 혼술바 피드 행. 썸네일=업체 인스타 프로필(원형 아바타). 하트는 소개팅과 동일(우상단·size20·#FF6B9D).
 * 영업중 옆 오늘 영업시간(회색) · 지역 · 거리 뒤에 "지도보기" 텍스트버튼.
 *
 * ⚠️(2026-08-26) 방문자 키워드 투표 해시태그를 눌러서 필터링하던 기능을 뺐다 — 네이버
 * 키워드 투표가 업체 대부분에 똑같이 붙는 고정 체크리스트라(예: "기본안주가좋아요"도
 * 상위7 기준 88.8%), 흔한 항목을 하나씩 빼도 다음 흔한 항목이 그 자리를 채우는
 * "두더지 잡기"가 반복돼(오너 지적: "이 방식은 아닌거 같다") 태그로 업체를 구분하는
 * 용도 자체가 이 데이터로는 성립이 안 된다고 판단, 해시태그 표시·필터를 통째로 제거.
 * 제목 옆에 아이콘만 있던 지도 버튼도 같은 이유(아이콘만 버튼 금지)로 "지도보기"
 * 텍스트버튼으로 바꾸고, 자리를 지역·거리 뒤로 옮겼다(오너 지시).
 *
 * ⚠️ 회색 보조 텍스트(영업시간·지역·거리·리뷰수)는 전부 같은 톤(textSecondary)·같은
 * 크기(12)로 통일한다 — 예전엔 줄마다 색 토큰(textSecondary/textTertiary)과 크기(12/11.5)가
 * 제각각이라 안에서마저 안 맞았다(2026-08-25 오너 지적: "글자색 크기가 왜 모두 제각각이냐").
 */
interface Props {
  place: PlaceRow
  isFavorite?: boolean
  onToggleFavorite?: () => void
  onMapPress?: (place: PlaceRow) => void
  /** 현재 위치로부터의 거리(km) — 거리순 정렬일 때만 부모가 넘겨준다. */
  distanceKm?: number
}

const AV = 54

export default function PlaceListItem({ place, isFavorite = false, onToggleFavorite, onMapPress, distanceKm }: Props) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { open, hoursLabel } = openStatus(place.hours)
  const cover = categoryCover(place.category)
  // 4번째 줄(편의시설) — 소개팅·소셜링은 4줄인데 혼술바만 3줄이라 카드 리듬이 안 맞았다
  // (오너 지적 2026-08-26: "혼술바에 한줄이 더 들어갈만한게 뭐가 있을지"). 흔한 순
  // 정렬(topConveniences)로 업체마다 갈리는 것부터 보여준다 — 자세한 이유는 lib/places.ts 참고.
  // 처음엔 상위 3개만 칩(배경 박스)으로 보여줬는데, 오너 지시(2026-08-26)로 배경 없는
  // 핑크색 텍스트 + 가운뎃점 나열로 바꾸고 개수도 3개 제한 없이 거의 다 보여주게 늘렸다.
  const conv = topConveniences(place.conveniences, 99)

  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push(`/place/${place.id}`)}>
      {/* 하트 — 소개팅과 동일(우상단·size20·#FF6B9D) */}
      {onToggleFavorite && (
        <TouchableOpacity style={styles.heart} onPress={(e) => { e.stopPropagation?.(); onToggleFavorite() }} activeOpacity={0.8} hitSlop={6}>
          <Ionicons name="bookmark" size={20} color={isFavorite ? '#FF6B9D' : colors.textTertiary} />
        </TouchableOpacity>
      )}

      {/* 원형 인스타 프로필 아바타 */}
      <View style={styles.avWrap}>
        {place.profile_image ? (
          <Image source={{ uri: place.profile_image }} style={styles.av} />
        ) : (
          <View style={[styles.av, styles.avFallback, { backgroundColor: cover.bg }]}><Ionicons name={cover.icon as any} size={24} color={cover.tint} /></View>
        )}
        {open != null && <View style={[styles.openDot, { backgroundColor: open ? colors.success : colors.textTertiary }]} />}
      </View>

      <View style={styles.info}>
        {/* 제목 */}
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{place.name}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaTextWrap}>
            {open != null ? (
              <>
                <Text style={[styles.op, { color: open ? colors.success : colors.textTertiary }]}>{open ? '영업중' : '영업종료'}</Text>
                {hoursLabel && <Text style={styles.hours}>{'  '}{hoursLabel}</Text>}
              </>
            ) : (
              <Text style={styles.hours}>영업시간 정보 없음</Text>
            )}
            <Text style={styles.meta} numberOfLines={1}>
              {'  ·  '}{place.region ?? ''}{distanceKm != null ? ` · ${formatDistanceKm(distanceKm)}` : ''}
            </Text>
          </View>
          {onMapPress && place.lat && (
            <TouchableOpacity hitSlop={6} onPress={(e) => { e.stopPropagation?.(); onMapPress(place) }} style={styles.mapTextBtn}>
              <Text style={styles.mapTextBtnLabel}>지도보기</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 편의시설(2026-08-26) — 눌러도 필터링 안 되는 정보성 표시. 배경 박스 없이
            핑크색 글자를 가운뎃점으로 나열(오너 지시). 다 보여줘야 해서 줄바꿈 허용. */}
        {conv.length > 0 && (
          <Text style={styles.convText}>{conv.join(' · ')}</Text>
        )}

        {/* 평점 — 별도 줄(2026-08-24 오너 지시). 소개팅·소셜링은 참여현황이 한 줄 더 있어서
            혼술바만 카드가 짧고 어색했는데, 이걸로 줄 수가 맞는다. 네이버 평점 없는(백필 전/
            리뷰 없는) 매장은 이 줄 자체가 안 뜬다. */}
        {place.naver_rating != null && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color="#FFB800" />
            <Text style={styles.ratingScore}>{place.naver_rating.toFixed(2)}</Text>
            {place.naver_review_count != null && (
              <Text style={styles.ratingCount}>리뷰 {place.naver_review_count.toLocaleString()}</Text>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, marginHorizontal: 16, marginVertical: 5, paddingVertical: 11, paddingHorizontal: 13, gap: 12 },
    heart: { position: 'absolute', top: 8, right: 10, zIndex: 2 },
    avWrap: { position: 'relative' },
    av: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.divider },
    avFallback: { alignItems: 'center', justifyContent: 'center' },
    openDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.surface },
    info: { flex: 1, gap: 3, paddingRight: 24 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    // 소개팅 제목과 동일: fontSize 14 · weight 700 · lineHeight 19
    name: { flexShrink: 1, fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 19 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    // 영업시간·지역·거리 텍스트 묶음 — flex:1 을 주면 내용이 짧아도(거리 없이 지역만
    // 있을 때 등) 이 View 가 줄 끝까지 늘어나 버려서 "지도보기" 버튼이 텍스트와 안
    // 붙고 줄 맨 끝에 혼자 떨어져 보였다(오너 지적: "지도보기 글자만 혼자
    // 떨어져있다"). flexShrink 만 줘서 내용 길이만큼만 차지하게 하고(넘칠 때만
    // 줄어들어 meta 텍스트가 말줄임되게), 버튼이 항상 텍스트 바로 뒤에 붙게 한다.
    metaTextWrap: { flexShrink: 1, flexDirection: 'row', alignItems: 'center' },
    op: { fontSize: 12, fontWeight: '800' },
    // 회색 보조 텍스트 톤·크기 통일 — textSecondary/12 하나로.
    hours: { fontSize: 12, color: colors.textSecondary },
    meta: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
    // 아이콘만 있던 지도 버튼 대신 텍스트버튼(오너 지시 2026-08-26) — 지역·거리 뒤로 위치 이동.
    mapTextBtn: { paddingLeft: 8, paddingVertical: 2 },
    mapTextBtnLabel: { fontSize: 12, fontWeight: '700', color: colors.primary },
    // 편의시설 — 배경 박스 없이 핑크(primary)색 글자, 가운뎃점 나열(오너 지시 2026-08-26).
    convText: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 1 },
    // 평점 줄 — 소개팅·소셜링의 참여현황 줄과 같은 자리(2026-08-24 오너 지시).
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    ratingScore: { fontSize: 12.5, fontWeight: '800', color: colors.textPrimary },
    ratingCount: { fontSize: 12, color: colors.textSecondary, marginLeft: 2 },
  })
}
