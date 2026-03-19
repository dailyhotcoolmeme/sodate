import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Colors } from '@/constants/colors'

interface Props {
  label: string
}

export default function ThemeTag({ label }: Props) {
  return (
    <View style={styles.tag}>
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tag: {
    backgroundColor: Colors.tagBackground,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: {
    color: Colors.tagText,
    fontSize: 11,
    fontWeight: '500',
  },
})
