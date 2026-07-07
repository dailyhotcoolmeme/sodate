import React from 'react'
import { Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

/**
 * 성별 가격 티어 표시(에모셔널오렌지 전용 price_detail).
 * - 정가 + 얼리버드(할인가)를 함께 노출.
 * - 얼리버드가 품절이면 "얼리버드 N원 (품절)" 글자에 취소선.
 * - price_detail 이 없으면 상위에서 fallback 문자열을 그대로 쓴다(이 컴포넌트 미사용).
 */
export type GenderPrice = {
  regular?: number
  regular_soldout?: boolean
  earlybird?: number
  earlybird_soldout?: boolean
}

const won = (n: number) => `${n.toLocaleString()}원`

export default function PriceTierValue({
  gender,
  age,
}: {
  gender: GenderPrice
  age?: string | null
}) {
  const colors = useColors()
  const styles = StyleSheet.create({
    base: { fontSize: 14, color: colors.textPrimary },
    muted: { color: colors.textSecondary },
    strike: { textDecorationLine: 'line-through', color: colors.textTertiary },
    sold: { color: colors.textTertiary },
  })

  const ageText = age ? (/세\s*$/.test(age) ? age : `${age}세`) : null

  return (
    <Text style={styles.base} numberOfLines={2}>
      {/* 정가 */}
      {gender.regular != null && (
        <Text style={gender.regular_soldout ? styles.strike : undefined}>
          {won(gender.regular)}
          {gender.regular_soldout ? ' (품절)' : ''}
        </Text>
      )}

      {/* 얼리버드(할인가) */}
      {gender.earlybird != null && (
        <>
          <Text style={styles.muted}>{'  ·  '}</Text>
          <Text style={gender.earlybird_soldout ? styles.strike : styles.muted}>
            얼리버드 {won(gender.earlybird)}
            {gender.earlybird_soldout ? ' (품절)' : ''}
          </Text>
        </>
      )}

      {/* 연령 */}
      {ageText && (
        <>
          <Text style={styles.muted}>{'  ·  '}</Text>
          <Text style={styles.muted}>{ageText}</Text>
        </>
      )}
    </Text>
  )
}
