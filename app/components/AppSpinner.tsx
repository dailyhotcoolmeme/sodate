import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import { useColors } from '@/hooks/useColors'

interface Props {
  size?: number
}

/**
 * 브랜드 로딩 스피너 — 핑크 호(arc)가 매끄럽게 도는 미니멀 링(C안).
 * 앱 전역 로딩 표시의 기본 비주얼. 화면 중앙 오버레이([[LoadingOverlay]])·페이지 로딩 공용.
 */
export default function AppSpinner({ size = 44 }: Props) {
  const colors = useColors()
  const rot = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true })
    )
    anim.start()
    return () => anim.stop()
  }, [rot])

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  const borderWidth = Math.max(3, Math.round(size / 12))

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
          borderColor: colors.surfaceHigh,
          borderTopColor: colors.primary,
          borderRightColor: colors.primary,
          transform: [{ rotate: spin }],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  ring: { backgroundColor: 'transparent' },
})
