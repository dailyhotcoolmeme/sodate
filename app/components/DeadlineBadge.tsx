import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

interface Props {
  daysLeft: number
}

export default function DeadlineBadge({ daysLeft }: Props) {
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    badge: {
      position: 'absolute',
      top: 10,
      right: 10,
      backgroundColor: colors.deadline,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    text: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '700',
    },
  }), [colors])

  const label = daysLeft === 0 ? '오늘 마감' : `D-${daysLeft}`
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}
