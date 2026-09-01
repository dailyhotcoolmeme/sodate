import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

/**
 * 제휴업체 딱지 '모잇 할인' — 일정 제목 / 혼술바 매장명 앞에 붙는다(2026-09-02 오너 확정).
 *
 * ## 왜 '제휴'가 아니라 '모잇 할인'인가
 * '제휴'는 우리 사정이지 사용자 이득이 아니다. 제휴사에 약속한 건 "모잇 통해서
 * 신청을 언급한 참여자에게 할인"이므로, 사용자가 볼 문구도 그쪽이어야 한다.
 *
 * ## 왜 꽉 찬 핑크에 각진 모서리인가
 * 후보 6개를 실제 카드에 얹어 비교한 뒤 오너가 고른 안(B). 연한 배경(기존 ThemeBadge
 * 규격)은 다른 배지에 묻혀 안 보였고, 대비색(라임)은 눈에 제일 띄지만 앱에 없는 색이라
 * 광고처럼 붕 떴다. 반지름 6은 ThemeBadge·DeadlineBadge·'마감'과 같은 값이다 —
 * 딱지 하나 때문에 새 모양을 들이지 않는다.
 *
 * ## 표시 조건은 이 컴포넌트가 정하지 않는다
 * 호출부가 isPartner 를 계산해 넘긴다(소개팅·소셜링은 companies.plan, 혼술바는
 * 기간까지 따져야 해서 lib/partner.ts 에 모아뒀다).
 */
export default function PartnerBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const colors = useColors()
  const small = size === 'sm'
  const styles = useMemo(
    () =>
      StyleSheet.create({
        badge: {
          alignSelf: 'flex-start',
          backgroundColor: colors.primary,
          borderRadius: 6,
          paddingHorizontal: small ? 7 : 8,
          paddingVertical: small ? 3.5 : 4,
        },
        // 흰 글씨 + 브랜드 핑크가 이 화면에서 얻을 수 있는 최대 대비다.
        text: { color: '#FFFFFF', fontSize: small ? 11 : 12.5, fontWeight: '800' },
      }),
    [colors, small]
  )
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>모잇 할인</Text>
    </View>
  )
}
