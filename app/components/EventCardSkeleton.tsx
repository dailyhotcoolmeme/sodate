import React, { useEffect, useRef, useMemo } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { useColors } from '@/hooks/useColors'

interface Props {
  /** 로딩 스켈레톤 모양 — 홈 뷰모드와 일치시켜야 함(카드형/리스트형) */
  variant?: 'card' | 'list'
}

export default function EventCardSkeleton({ variant = 'card' }: Props) {
  const opacity = useRef(new Animated.Value(0.4)).current
  const colors = useColors()
  const styles = useMemo(() => StyleSheet.create({
    // 카드형
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      marginHorizontal: 16,
      marginVertical: 8,
      overflow: 'hidden',
    },
    image: { width: '100%', height: 200, backgroundColor: colors.surfaceHigh },
    content: { padding: 16 },
    // 리스트형 — EventListItem과 동일 레이아웃(썸네일 88 + 우측 텍스트)
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginHorizontal: 16,
      marginVertical: 5,
      padding: 12,
      gap: 12,
    },
    leftCol: { alignItems: 'center', width: 88 },
    thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    companyUnder: { width: 56, height: 11, borderRadius: 4, backgroundColor: colors.surfaceHigh, marginTop: 6 },
    info: { flex: 1, gap: 8, paddingTop: 2 },
    line: { backgroundColor: colors.surfaceHigh, borderRadius: 4 },
  }), [colors])

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [opacity])

  if (variant === 'list') {
    return (
      <Animated.View style={[styles.row, { opacity }]}>
        <View style={styles.leftCol}>
          <View style={styles.thumb} />
          <View style={styles.companyUnder} />
        </View>
        <View style={styles.info}>
          <View style={[styles.line, { width: '85%', height: 14 }]} />
          <View style={[styles.line, { width: '55%', height: 12 }]} />
          <View style={[styles.line, { width: '70%', height: 12 }]} />
          <View style={[styles.line, { width: '45%', height: 12 }]} />
        </View>
      </Animated.View>
    )
  }

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
