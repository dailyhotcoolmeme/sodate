import React, { useEffect, useRef, useMemo } from 'react'
import { View, StyleSheet, Animated, Easing } from 'react-native'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'

/**
 * 게시판 목록 뼈대 — 2026-09-03.
 *
 * 처음 설치했거나 저장해 둔 목록이 없을 때만 보인다(있으면 지난 목록을 바로 그리므로
 * 이 화면 자체가 안 나온다). 빈 화면에 스피너 하나만 도는 것보다, 곧 채워질 자리가
 * 보이는 편이 실제로 더 빨라 보이고 화면이 덜 튄다.
 *
 * 줄 구성은 실제 목록(PostRow)과 같다 — 제목 줄 + 캐릭터·닉네임 줄.
 */
export default function BoardListSkeleton({ rows = 8 }: { rows?: number }) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [pulse])

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] })

  return (
    <View>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          {/* 제목 줄 — 길이를 조금씩 다르게 해야 진짜 목록처럼 보인다 */}
          <Animated.View style={[styles.bar, { opacity, width: `${58 + ((i * 13) % 34)}%` }]} />
          <View style={styles.metaRow}>
            <Animated.View style={[styles.avatar, { opacity }]} />
            <Animated.View style={[styles.barSmall, { opacity, width: `${34 + ((i * 7) % 18)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    row: {
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 8,
    },
    bar: { height: 14, borderRadius: 4, backgroundColor: colors.surfaceHigh },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    avatar: { width: 15, height: 15, borderRadius: 8, backgroundColor: colors.surfaceHigh },
    barSmall: { height: 10, borderRadius: 3, backgroundColor: colors.surfaceHigh },
  })
}
