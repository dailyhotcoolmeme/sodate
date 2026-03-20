import React, { useEffect, useRef, useMemo } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { useColors } from '@/hooks/useColors'

export default function EventCardSkeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      marginHorizontal: 16,
      marginVertical: 8,
      overflow: 'hidden',
    },
    image: {
      width: '100%',
      height: 200,
      backgroundColor: colors.surfaceHigh,
    },
    content: {
      padding: 16,
    },
    line: {
      backgroundColor: colors.surfaceHigh,
      borderRadius: 4,
    },
  }), [colors])

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [opacity])

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <View style={styles.image} />
      <View style={styles.content}>
        <View style={[styles.line, { width: '40%', height: 12 }]} />
        <View style={[styles.line, { width: '80%', height: 16, marginTop: 8 }]} />
        <View style={[styles.line, { width: '60%', height: 12, marginTop: 6 }]} />
        <View style={[styles.line, { width: '50%', height: 12, marginTop: 4 }]} />
        <View style={[styles.line, { width: '100%', height: 40, marginTop: 12, borderRadius: 10 }]} />
      </View>
    </Animated.View>
  )
}
