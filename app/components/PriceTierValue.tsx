import React from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

// 년생(출생연도) 기반 업체 — 연령을 만나이로 저장하되 출생연도 보조표시를 붙인다(admin과 동일).
export const BIRTH_YEAR_VENDORS = new Set(['yeonin', 'lovecommunity-loco', 'talkblossom', 'frip', 'modparty'])

// 만나이 'NN~NN' → 출생연도 힌트 'YY~YY년생' (년생 기반 업체용, 오너 표준). admin과 동일 로직.
export function bornHint(age?: string | null): string | null {
  if (!age) return null
  const m = age.replace(/\s/g, '').match(/^(\d{1,2})~(\d{1,2})$/)
  if (!m) return null
  const yr = new Date().getFullYear()
  const p = (n: number) => String(((n % 100) + 100) % 100).padStart(2, '0')
  return `${p(yr - parseInt(m[2]))}~${p(yr - parseInt(m[1]))}년생` // 나이많은쪽(이른출생)~나이적은쪽
}

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
  birthYear,
}: {
  detail?: GenderPrice | null
  price?: number | null
  age?: string | null
  compact?: boolean
  soldout?: boolean          // 이 성별 좌석 마감 → 가격 취소선 + (마감)
  birthYear?: boolean        // 년생 기반 업체 → 연령 밑에 출생연도 보조표시
}) {
  const colors = useColors()
  const size = compact ? 12 : 14
  const styles = StyleSheet.create({
    base: { fontSize: size, color: colors.textPrimary },
    muted: { fontSize: size, color: colors.textSecondary },
    strike: { fontSize: size, textDecorationLine: 'line-through', color: colors.textTertiary },
    born: { fontSize: size - 3, color: colors.textTertiary, marginTop: 1 },
  })

  const regular = detail?.regular ?? (price ?? null)
  const regularSold = (detail?.regular_soldout ?? false) || !!soldout
  const at = fmtAge(age)
  if (regular == null && !at && !regularSold) return null

  const born = birthYear ? bornHint(age) : null

  const line = (
    <Text style={styles.base} numberOfLines={compact ? 1 : 2} adjustsFontSizeToFit={compact} minimumFontScale={0.6}>
      {/* 정가 (품절이면 취소선). 가격 없이 매진이면 '마감'만 표시 */}
      {regular != null ? (
        <Text style={regularSold ? styles.strike : undefined}>
          {wonRange(regular, detail?.regular_max)}{regularSold ? ' (마감)' : ''}
        </Text>
      ) : regularSold ? (
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
          <Text style={styles.muted}>{regular != null ? '  ·  ' : ''}</Text>
          <Text style={styles.muted}>{at}</Text>
        </>
      )}
    </Text>
  )

  // 출생연도 보조표시는 연령 밑 작은 글씨(년생 기반 업체만)
  if (!born) return line
  return (
    <View>
      {line}
      <Text style={styles.born}>{born}</Text>
    </View>
  )
}
