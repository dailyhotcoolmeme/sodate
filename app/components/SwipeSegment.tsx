import React, { useRef } from 'react'
import { View, PanResponder, StyleSheet, Dimensions } from 'react-native'
import { useRouter } from 'expo-router'

// 소개팅 ↔ 커뮤니티 화면을 좌우 스와이프로 전환한다. 톱바 토글과 같은 router.replace를
// 쓰므로, 스와이프로 화면이 바뀌면 새 화면의 톱바가 pathname을 보고 토글도 알아서 맞춰진다
// (TopBar.tsx의 seg 판정 로직 재사용, 별도 동기화 코드 불필요).
//
// PanResponderCapture로 "가로 움직임이 세로보다 뚜렷하게 클 때만" 제스처를 가져간다.
// 탭이나 세로 스크롤(리스트 아이템 선택, 피드/게시글 스크롤)은 이 조건을 만족 못 해
// capture가 계속 false를 반환 → 원래 자식(FlatList/버튼)이 터치를 그대로 받는다.
// ScrollView 기반 페이저보다 오작동(스크롤/탭이 스와이프에 먹히는 것) 위험이 낮다.
const MIN_DX = 12          // 이 정도는 움직여야 스와이프 후보로 본다(손떨림 방지)
const DIRECTION_RATIO = 1.8 // 가로가 세로보다 이만큼은 커야 스와이프로 확정
const RELEASE_THRESHOLD = Dimensions.get('window').width * 0.22 // 화면폭의 22% 넘게 밀어야 전환

export default function SwipeSegment({ current, children }: { current: 'event' | 'board'; children: React.ReactNode }) {
  const router = useRouter()
  const captured = useRef(false)

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
          router.replace('/board')
        } else if (g.dx >= RELEASE_THRESHOLD && current === 'board') {
          router.replace('/')
        }
      },
      onPanResponderTerminate: () => { captured.current = false },
    })
  ).current

  return (
    <View style={styles.fill} {...panResponder.panHandlers}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
