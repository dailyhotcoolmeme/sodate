import React, { useEffect, useMemo, useRef } from 'react'
import { PanResponder, StyleSheet, Dimensions, Animated } from 'react-native'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'

// 소개팅 ↔ 커뮤니티 화면을 좌우 스와이프로 전환한다. 톱바 토글과 같은 router.replace를
// 쓰므로, 스와이프로 화면이 바뀌면 새 화면의 톱바가 pathname을 보고 토글도 알아서 맞춰진다
// (TopBar.tsx의 seg 판정 로직 재사용, 별도 동기화 코드 불필요).
//
// PanResponderCapture로 "가로 움직임이 세로보다 뚜렷하게 클 때만" 제스처를 가져간다.
// 탭이나 세로 스크롤(리스트 아이템 선택, 피드/게시글 스크롤)은 이 조건을 만족 못 해
// capture가 계속 false를 반환 → 원래 자식(FlatList/버튼)이 터치를 그대로 받는다.
// ScrollView 기반 페이저보다 오작동(스크롤/탭이 스와이프에 먹히는 것) 위험이 낮다.
// 2026-08-09 오너 지적: 피드에서 탭이 가끔 안 눌린다 — 기준이 낮아서 평범한 탭의
// 손가락 미세 움직임(몇 px)까지 스와이프 후보로 잡혀 터치가 가로채였다(실제로 화면이
// 안 넘어가도, 탭 자체는 이미 죽어버림). 기준을 확 올려서 진짜 스와이프만 반응하게.
const MIN_DX = 24          // 이 정도는 움직여야 스와이프 후보로 본다(탭 손떨림 방지)
const DIRECTION_RATIO = 2.2 // 가로가 세로보다 이만큼은 커야 스와이프로 확정
const SCREEN_WIDTH = Dimensions.get('window').width
const RELEASE_THRESHOLD = SCREEN_WIDTH * 0.22 // 화면폭의 22% 넘게 밀어야 전환
// "넘어간다"는 느낌만 살짝 주는 슬라이드 인 폭 — 화면폭 전체로 하면 굼떠 보여서 일부만
// (2026-08-08 오너 요청: 전환 시 살짝 효과).
const ENTER_OFFSET = SCREEN_WIDTH * 0.18
const ENTER_DURATION = 200

// router.replace는 화면을 통째로 새로 마운트한다(같은 컴포넌트 인스턴스가 이어지지 않음).
// "이 화면이 스와이프로 막 도착한 건지, 토글/직접 진입인지"를 다음 마운트에 넘기려고
// 모듈 전역 변수를 쓴다 — 스와이프 순간에만 세팅하고 다음 마운트가 즉시 읽어서 비운다.
// 앱 프로세스 안에서만 유효, 재시작하면 자연히 null.
let pendingEnterFrom: 'left' | 'right' | null = null

export default function SwipeSegment({ current, children }: { current: 'event' | 'board'; children: React.ReactNode }) {
  const router = useRouter()
  const colors = useColors()
  const captured = useRef(false)

  // 마운트 시점에 딱 한 번 읽고 바로 비운다. 스와이프로 도착했으면 반대쪽에서 슬쩍
  // 들어오는 시작 위치를, 아니면(토글·딥링크·직접 진입) 0(제자리)을 초기값으로 삼는다.
  // ⚠️ 부호는 "보이는 틈이 어느 쪽에 생기는지"와 반대다 — content가 +쪽으로 밀려있으면
  // 아직 못 채운 반대쪽(-쪽, 화면 왼쪽)에 틈이 보인다. 2026-08-08 오너가 "왼쪽에 살짝
  // 버그처럼 보인다, 오른쪽으로 옮겨봐라"고 지적 → 부호를 반전(틈이 오른쪽에 생기게).
  const translateX = useRef(new Animated.Value((() => {
    const from = pendingEnterFrom
    pendingEnterFrom = null
    if (from === 'right') return -ENTER_OFFSET
    if (from === 'left') return ENTER_OFFSET
    return 0
  })())).current

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: ENTER_DURATION,
      useNativeDriver: true,
    }).start()
    // 마운트 시 1회만 — translateX는 useRef라 안정적, exhaustive-deps 불필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 슬라이드 중 아직 안 채워진 쪽으로 배경이 비쳐 보이던 것(오너 지적: "버그처럼 보인다")을
  // 막기 위해 화면 배경색으로 뒤를 채운다.
  const fillStyle = useMemo(() => [styles.fill, { backgroundColor: colors.background }], [colors])

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_evt, g) => {
        const horizontal = Math.abs(g.dx) > MIN_DX && Math.abs(g.dx) > Math.abs(g.dy) * DIRECTION_RATIO
        captured.current = horizontal
        return horizontal
      },
      onPanResponderMove: () => {},
      onPanResponderRelease: (_evt, g) => {
        if (!captured.current) return
        captured.current = false
        if (g.dx <= -RELEASE_THRESHOLD && current === 'event') {
          pendingEnterFrom = 'right' // 다음(커뮤니티) 화면은 오른쪽에서 들어온다
          router.replace('/board')
        } else if (g.dx >= RELEASE_THRESHOLD && current === 'board') {
          pendingEnterFrom = 'left' // 다음(소개팅) 화면은 왼쪽에서 들어온다
          router.replace('/')
        }
      },
      onPanResponderTerminate: () => { captured.current = false },
    })
  ).current

  return (
    <Animated.View style={[fillStyle, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
