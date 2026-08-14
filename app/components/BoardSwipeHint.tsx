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
// 완전히 화면 안으로 들어오는 지점(0) — 이보다 더 왼쪽(음수)으로는 절대 못 가게
// overshootClamping을 건다. 안 걸면 스프링이 0을 살짝 지나쳐, 탭이 화면 끝보다
// 더 안쪽으로 밀리면서 화면 끝과 탭 사이에 배경색 빈 틈이 비쳤다(2026-08-14 오너 지적).
// 뒤에 같은 색 배경을 깔아 메우는 방법도 써봤지만, 탭에만 그림자가 있어서 "층이 나뉜
// 별개 물체"처럼 보인다는 재지적을 받았다 — 아예 못 넘어가게 막는 쪽이 근본적인 해결.
const PEEK_X = 0

/**
 * 모임 피드 오른쪽 끝에서 통통 튀며 "왼쪽으로 스와이프하면 커뮤니티" 임을 알리는 힌트
 * (2026-08-14 오너 지시). 커뮤니티(게시판)에 한 번이라도 들어가 본 기기에는 다시
 * 보여줄 이유가 없어, lib/boardIdentity.ts의 기록을 보고 안 가본 기기에서만 마운트한다.
 *
 * "통통 튀는" 느낌은 위치(translateX) 오버슈트 대신 스케일 펄스로 낸다 — 커지는 쪽으로만
 * 움직이므로(1 → 1.14 → 1) 탭이 화면 끝보다 작아질 일이 없어 배경이 비칠 걱정이 없다.
 * 흔한 온보딩 넛지 패턴(아이콘을 살짝 키웠다 되돌리는 pulse)과 같은 방식.
 *
 * SwipeSegment가 이미 왼쪽 스와이프 → /board 전환을 처리하므로, 이 탭 자체를 눌러도
 * 같은 곳으로 보낸다 — 힌트를 보고도 스와이프 대신 탭하는 사람을 위한 배려.
 */
export default function BoardSwipeHint() {
  const colors = useColors()
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const translateX = useRef(new Animated.Value(HIDDEN_X)).current
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    let alive = true
    getBoardVisited().then((visited) => { if (alive && !visited) setVisible(true) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!visible) return
    // 위치는 0(완전히 나온 상태)을 절대 못 넘게(overshootClamping) 통통 나왔다 들어가고,
    // 나온 순간엔 스케일까지 살짝 부풀렸다 되돌려 두 번 튀는 느낌을 더한다. 오래 머문 뒤
    // 들어가고, 쉬는 시간을 짧게 잡아 자주 반복되게 했다(2026-08-14 오너 지적 반영).
    const pop = Animated.spring(scale, {
      toValue: 1.14, useNativeDriver: true, friction: 3, tension: 200, overshootClamping: false,
    })
    const settle = Animated.spring(scale, {
      toValue: 1, useNativeDriver: true, friction: 4, tension: 200, overshootClamping: true,
    })
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.parallel([
          Animated.spring(translateX, { toValue: PEEK_X, useNativeDriver: true, friction: 5, tension: 120, overshootClamping: true }),
          pop,
        ]),
        Animated.delay(120),
        settle,
        Animated.delay(500),
        Animated.parallel([
          Animated.spring(translateX, { toValue: PEEK_X, useNativeDriver: true, friction: 5, tension: 160, overshootClamping: true }),
          Animated.spring(scale, { toValue: 1.14, useNativeDriver: true, friction: 3, tension: 200, overshootClamping: false }),
        ]),
        Animated.delay(120),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 200, overshootClamping: true }),
        Animated.delay(900),
        Animated.timing(translateX, { toValue: HIDDEN_X, duration: 280, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1300),
      ])
    )
    bounce.start()
    return () => bounce.stop()
  }, [visible, translateX, scale])

  if (!visible) return null

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.replace('/board')}
      style={styles.wrap}
      hitSlop={{ left: 10, top: 10, bottom: 10 }}
    >
      <Animated.View style={[styles.tab, { backgroundColor: colors.primary, transform: [{ translateX }, { scale }] }]}>
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
