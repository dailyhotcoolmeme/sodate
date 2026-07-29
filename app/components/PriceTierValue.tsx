import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

// 출생연도(년생)는 앱(피드·상세)에 절대 표시 안 함 — admin 검증용에만 표시(오너 규칙).
// 앱 연령은 항상 만나이만.

/**
 * 성별 가격+연령 표시 (카드·목록·상세 공용).
 * - price_detail(에모셔널오렌지/연인어때 등)이 있으면 정가·얼리버드·품절을 표시.
 * - 품절이면 "가격 (품절)"에 취소선.
 * - price_detail 없으면 단순 price + age.
 * - compact: 카드/목록용(작은 글자, 얼리버드 생략, 한 줄).
 */
export type GenderPrice = {
  regular?: number
  regular_max?: number       // 있으면 범위 표시(예: MVP 59,000~74,900원)
  regular_soldout?: boolean
  earlybird?: number
  earlybird_soldout?: boolean
}

const won = (n: number) => `${n.toLocaleString()}원`
// 단일가 또는 범위(min~max) 표기
const wonRange = (min: number, max?: number | null) =>
  max != null && max > min ? `${min.toLocaleString()}~${max.toLocaleString()}원` : won(min)
// 'NN' 또는 'NN~NN' 형태만 "세" 부착(27~34→27~34세). 그 외는 그대로 표시
// ('2030'→2030, '30대'→30대, '나이 무관'→나이 무관)
const fmtAge = (age?: string | null) =>
  age ? (/^\d{1,2}(~\d{1,2})?$/.test(age.replace(/\s/g, '')) ? `${age}세` : age) : null

export default function PriceTierValue({
  detail,
  price,
  age,
  compact,
  soldout,
}: {
  detail?: GenderPrice | null
  price?: number | null
  age?: string | null
  compact?: boolean
  soldout?: boolean          // 이 성별 좌석 마감 → 가격에 취소선 + (마감)
}) {
  const colors = useColors()
  const size = compact ? 12 : 14
  const styles = StyleSheet.create({
    base: { fontSize: size, color: colors.textPrimary },
    muted: { fontSize: size, color: colors.textSecondary },
    strike: { fontSize: size, textDecorationLine: 'line-through', color: colors.textTertiary },
  })

  const regular = detail?.regular ?? (price ?? null)
  const regularSold = (detail?.regular_soldout ?? false) || !!soldout
  const at = fmtAge(age)
  // ⚠️ 가격이 없어도 그 성별이 마감이면 마감이라고 알려야 한다. 예전엔 가격이 null이면
  //    마감 표시를 통째로 건너뛰어, 실제로는 매진인데 앱에선 나이만 덩그러니 보였다.
  //    (2026-07-29 시크릿살롱 '1:1 SIGNAL MESSAGE': 사이트가 남성 6/6 마감이라 남성
  //     가격 옵션이 사라졌는데, 앱은 마감인지 아닌지 알 수 없는 상태로 보였다)
  const soldOutOnly = regular == null && regularSold
  if (regular == null && !at && !soldOutOnly) return null

  return (
    <Text style={styles.base} numberOfLines={compact ? 1 : 2} adjustsFontSizeToFit={compact} minimumFontScale={0.6}>
      {/* 정가 (마감/품절이면 취소선 + (마감)) — 다른 업체와 동일: 가격 (마감) 취소선 · 나이 */}
      {regular != null ? (
        <Text style={regularSold ? styles.strike : undefined}>
          {wonRange(regular, detail?.regular_max)}{regularSold ? ' (마감)' : ''}
        </Text>
      ) : soldOutOnly ? (
        <Text style={styles.muted}>마감</Text>
      ) : null}

      {/* 얼리버드 — 상세에서만(카드는 compact로 생략) */}
      {!compact && detail?.earlybird != null && (
        <>
          <Text style={styles.muted}>{'  ·  '}</Text>
          <Text style={detail.earlybird_soldout ? styles.strike : styles.muted}>
            얼리버드 {won(detail.earlybird)}{detail.earlybird_soldout ? ' (품절)' : ''}
          </Text>
        </>
      )}

      {/* 연령 */}
      {at && (
        <>
          <Text style={styles.muted}>{regular != null || soldOutOnly ? '  ·  ' : ''}</Text>
          <Text style={styles.muted}>{at}</Text>
        </>
      )}
    </Text>
  )
}
