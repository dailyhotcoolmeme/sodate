import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'

interface Props {
  size?: number
}

/**
 * 브랜드 하트 비트 스피너 — 핑크 하트가 콩닥콩닥(lub-dub) 뛰는 로딩 인디케이터.
 * 앱 전역 로딩 표시의 기본 비주얼. 화면 중앙 오버레이([[LoadingOverlay]])·페이지 로딩에 공용.
 */
export default function HeartSpinner({ size = 44 }: Props) {
  const colors = useColors()
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    // lub-dub 두 번 뛰는 리듬(총 1.1s) 반복
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.22, duration: 198, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.02, duration: 154, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.16, duration: 154, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 594, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    )
    beat.start()
    return () => beat.stop()
  }, [scale])

  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          { transform: [{ scale }] },
          // iOS는 은은한 핑크 글로우, Android는 스케일만(자연 degrade)
          Platform.OS === 'ios' && {
            shadowColor: colors.primary,
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      >
        <Ionicons name="heart" size={size} color={colors.primary} />
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
})
