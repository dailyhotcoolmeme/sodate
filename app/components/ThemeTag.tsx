import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

interface Props {
  label: string
}

export default function ThemeTag({ label }: Props) {
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    tag: {
      backgroundColor: colors.tagBackground,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    text: {
      color: colors.tagText,
      fontSize: 11,
      fontWeight: '500',
    },
  }), [colors])

  return (
    <View style={styles.tag}>
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}
