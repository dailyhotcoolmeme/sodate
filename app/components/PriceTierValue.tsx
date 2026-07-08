import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

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
// 숫자로 끝나면 "세" 부착(27~34→27~34세), 아니면 그대로("나이 무관")
const fmtAge = (age?: string | null) =>
  age ? (/\d\s*$/.test(age) ? `${age}세` : age) : null

export default function PriceTierValue({
  detail,
  price,
  age,
  compact,
}: {
  detail?: GenderPrice | null
  price?: number | null
  age?: string | null
  compact?: boolean
}) {
  const colors = useColors()
  const size = compact ? 12 : 14
  const styles = StyleSheet.create({
    base: { fontSize: size, color: colors.textPrimary },
    muted: { fontSize: size, color: colors.textSecondary },
    strike: { fontSize: size, textDecorationLine: 'line-through', color: colors.textTertiary },
  })

  const regular = detail?.regular ?? (price ?? null)
  const regularSold = detail?.regular_soldout ?? false
  const at = fmtAge(age)
  if (regular == null && !at) return null

  return (
    <Text style={styles.base} numberOfLines={compact ? 1 : 2} adjustsFontSizeToFit={compact} minimumFontScale={0.6}>
      {/* 정가 (품절이면 취소선) */}
      {regular != null && (
        <Text style={regularSold ? styles.strike : undefined}>
          {wonRange(regular, detail?.regular_max)}{regularSold ? ' (품절)' : ''}
        </Text>
      )}

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
          <Text style={styles.muted}>{regular != null ? '  ·  ' : ''}</Text>
          <Text style={styles.muted}>{at}</Text>
        </>
      )}
    </Text>
  )
}
