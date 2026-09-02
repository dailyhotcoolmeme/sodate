import React, { useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import { openOutlink } from '@/lib/outlink'
import { buildSocialLinks, type SocialKey } from '@/lib/socialLinks'

/**
 * 업체·매장 외부 링크 아이콘 줄 — 이름 바로 밑(2026-09-02 오너 지시).
 *
 * **등록된 것만 그린다.** 하나도 없으면 아무것도 안 그리고 자리도 안 차지한다
 * (예전엔 링크가 없어도 '홈페이지' 버튼이 항상 떴다).
 */
export default function SocialLinkRow({
  socials,
  fallback,
  size = 18,
}: {
  socials?: Record<string, string> | null
  fallback?: Partial<Record<SocialKey, string | null | undefined>>
  size?: number
}) {
  const colors = useColors()
  const links = buildSocialLinks(socials, fallback)
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
        // 아이콘만 있는 줄이라 터치 영역이 아이콘 크기로 쪼그라들지 않게 hitSlop 을 준다.
        btn: { paddingVertical: 2 },
      }),
    []
  )
  if (links.length === 0) return null
  return (
    <View style={styles.row}>
      {links.map((l) => (
        <TouchableOpacity
          key={l.key}
          style={styles.btn}
          hitSlop={8}
          activeOpacity={0.6}
          accessibilityRole="link"
          accessibilityLabel={l.label}
          onPress={() => openOutlink(l.url)}
        >
          <Ionicons name={l.icon} size={size} color={colors.textSecondary} />
        </TouchableOpacity>
      ))}
    </View>
  )
}
