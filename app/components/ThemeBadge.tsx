import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { getThemeBadge } from '@/constants/themeBadges'

// 테마 배지(피드·목록·상세 공용). theme 배열에 매칭 테마가 없으면 아무것도 렌더 안 함.
export default function ThemeBadge({
  theme,
  size = 'sm',
}: {
  theme?: string[] | null
  size?: 'sm' | 'md'
}) {
  const meta = getThemeBadge(theme)
  const small = size === 'sm'
  const styles = useMemo(
    () =>
      StyleSheet.create({
        badge: {
          alignSelf: 'flex-start',
          backgroundColor: meta?.bg,
          borderRadius: 6,
          paddingHorizontal: small ? 6 : 8,
          paddingVertical: small ? 2 : 3,
        },
        text: {
          color: meta?.color,
          fontSize: small ? 11 : 12.5,
          fontWeight: '800',
        },
      }),
    [meta, small]
  )
  if (!meta) return null
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{meta.label}</Text>
    </View>
  )
}
