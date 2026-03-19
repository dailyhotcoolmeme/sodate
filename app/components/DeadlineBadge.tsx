import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors } from '@/constants/colors'

interface Props {
  daysLeft: number
}

export default function DeadlineBadge({ daysLeft }: Props) {
  const label = daysLeft === 0 ? '오늘 마감' : `D-${daysLeft}`
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: Colors.deadline,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
})
