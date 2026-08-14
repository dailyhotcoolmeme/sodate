import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import { getBoardVisited } from '@/lib/boardIdentity'

const TAB_WIDTH = 30
const TAB_HEIGHT = 56
// 평소엔 이만큼만 화면 밖으로 숨어 있다가(edge peek), 통통 튀듯 나왔다 들어간다.
const HIDDEN_X = TAB_WIDTH * 0.62
// 완전히 화면 안으로 들어오는 지점(0) — 예전엔 4까지만 나와 절반쯤만 보이다 말아서
// 눈에 잘 안 띄었다(2026-08-14 오너 지적: "살짝 보이다가 멈춘 느낌"). 끝까지 나오게.
const PEEK_X = 0

/**
 * 모임 피드 오른쪽 끝에서 통통 튀며 "왼쪽으로 스와이프하면 커뮤니티" 임을 알리는 힌트
 * (2026-08-14 오너 지시). 커뮤니티(게시판)에 한 번이라도 들어가 본 기기에는 다시
 * 보여줄 이유가 없어, lib/boardIdentity.ts의 기록을 보고 안 가본 기기에서만 마운트한다.
 *
 * SwipeSegment가 이미 왼쪽 스와이프 → /board 전환을 처리하므로, 이 탭 자체를 눌러도
 * 같은 곳으로 보낸다 — 힌트를 보고도 스와이프 대신 탭하는 사람을 위한 배려.
 */
export default function BoardSwipeHint() {
  const colors = useColors()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const translateX = useRef(new Animated.Value(HIDDEN_X)).current

  useEffect(() => {
    let alive = true
    getBoardVisited().then((visited) => { if (alive && !visited) setVisible(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!visible) return
    // 한 번 톡 튀고 마는 게 아니라, 통통 두 번 튀듯 강조하고 훨씬 오래 머문 뒤 들어간다
    // (2026-08-14 오너 지적 반영). friction을 낮게 잡아 스프링 자체가 목표를 살짝
    // 지나쳤다 돌아오는 탄력(overshoot)이 나오게 했다 — 그게 "통통" 튀는 느낌의 핵심.
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.spring(translateX, { toValue: PEEK_X, useNativeDriver: true, friction: 3, tension: 110 }),
        Animated.delay(550),
        Animated.spring(translateX, { toValue: HIDDEN_X * 0.7, useNativeDriver: true, friction: 5, tension: 140 }),
        Animated.delay(90),
        Animated.spring(translateX, { toValue: PEEK_X, useNativeDriver: true, friction: 4, tension: 140 }),
        Animated.delay(1000),
        Animated.timing(translateX, { toValue: HIDDEN_X, duration: 280, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1300),
      ])
    )
    bounce.start()
    return () => bounce.stop()
  }, [visible, translateX])

  if (!visible) return null

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.replace('/board')}
      style={styles.wrap}
      hitSlop={{ left: 10, top: 10, bottom: 10 }}
    >
      <Animated.View style={[styles.tab, { backgroundColor: colors.primary, transform: [{ translateX }] }]}>
        <Ionicons name="chevron-back" size={17} color="#fff" />
      </Animated.View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', right: 0, top: '50%', marginTop: -TAB_HEIGHT / 2,
  },
  tab: {
    width: TAB_WIDTH, height: TAB_HEIGHT,
    borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: -2, height: 0 }, shadowOpacity: 0.18, shadowRadius: 6,
    elevation: 4,
  },
})
