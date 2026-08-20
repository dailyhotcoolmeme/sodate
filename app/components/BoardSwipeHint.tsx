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
 * 모임 피드 오른쪽 끝에서 통통 튀며 "옆으로 넘기면 커뮤니티" 임을 알리는 힌트
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
    /**
     * 나왔다 → 커졌다 작아졌다 → 한 번 더 → 쏙 들어갔다 를 반복한다.
     *
     * 2026-08-20 오너 지적: "너무 정적인 느낌, 이 모든 흐름의 속도가 더 빨라야 한다".
     *
     * 원인은 delay 만이 아니라 **스프링 자체**였다. 예전 값(tension 200 / friction 3)은
     * 감쇠비가 0.1 밖에 안 돼서, 눈에 보이는 움직임이 끝난 뒤에도 스프링이 미세하게
     * 계속 떨렸다. Animated.sequence 는 앞 단계가 완전히 멈춰야 다음으로 넘어가므로
     * 그 잔떨림 시간이 통째로 대기 시간이 됐다 — 한 동작 하고 한참 서 있는 것처럼 보인 이유다.
     *
     * 그래서 전부 timing 으로 바꿨다. 길이가 숫자로 딱 정해져서 잔떨림 대기가 없고,
     * 아래 합계 그대로 한 바퀴가 돈다(예전은 스프링 정착까지 합쳐 5초 이상).
     * "통통" 튀는 느낌은 스프링의 흔들림이 아니라 1 → 1.14 → 1 펄스와 back 이징이 낸다.
     *
     * ⚠️ translateX 에는 절대 overshoot 이징(back/elastic)을 쓰지 말 것. 0 을 넘어가면
     *    탭이 화면 끝보다 안쪽으로 밀려 배경 빈 틈이 비친다(2026-08-14 오너 지적).
     *    scale 은 커지는 쪽으로만 움직이므로 back 을 써도 안전하다.
     */
    const slideOut = () =>
      Animated.timing(translateX, {
        toValue: PEEK_X, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      })
    const grow = () =>
      Animated.timing(scale, {
        toValue: 1.14, duration: 110, easing: Easing.out(Easing.back(2.2)), useNativeDriver: true,
      })
    const shrink = () =>
      Animated.timing(scale, {
        toValue: 1, duration: 120, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
      })

    const bounce = Animated.loop(
      Animated.sequence([
        Animated.delay(140),
        Animated.parallel([slideOut(), grow()]),   // 150
        shrink(),                                   // 120
        Animated.delay(90),
        grow(),                                     // 110  ← 두 번째 통통
        shrink(),                                   // 120
        Animated.delay(240),
        Animated.timing(translateX, {               // 130  ← 쏙 들어감
          toValue: HIDDEN_X, duration: 130, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }),
        Animated.delay(840),                        // 다음 바퀴까지 쉼(오너 지시 2026-08-20: 420의 2배)
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
        {/*
          화살표는 손가락이 움직일 방향(왼쪽)이 아니라 **갈 곳이 어느 쪽인지**를 가리킨다
          (오너 지시 2026-08-20). 캐러셀의 '다음' 화살표가 오른쪽을 향하고 정작 제스처는
          왼쪽 스와이프인 것과 같은 관례다.

          이 앱에는 근거가 하나 더 있다 — 톱바 토글이 켜짐(오른쪽)=커뮤니티, 꺼짐(왼쪽)=소개팅
          이라 "커뮤니티는 오른쪽"이라고 이미 가르치고 있다. 여기서만 왼쪽 화살표를 쓰면
          같은 앱이 두 가지로 말하는 셈이 된다.
        */}
        <Ionicons name="chevron-forward" size={17} color="#fff" />
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
