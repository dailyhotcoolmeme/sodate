import React from 'react'
import { View, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import { avatarSource } from '@/lib/avatars'

/**
 * 글·댓글·후기 작성자의 캐릭터. 예전엔 캐릭터를 기기(AsyncStorage)에만 저장해서
 * **내 캐릭터를 나만 볼 수 있었다** — 남이 보면 닉네임 글자뿐이었다. 이제 작성 시점의
 * 캐릭터 id 를 같이 저장해(avatar_id) 모두에게 보인다(2026-09-03 오너 지시).
 *
 * still — 여러 개가 한꺼번에 뜨는 곳(게시판 목록·댓글)은 정지컷을 쓴다. 움직이는 원본은
 * 24개 1.6MB 라 목록에서 그대로 쓰면 그만큼 디코딩 비용이 늘어난다(lib/avatars.ts 주석).
 */
export default function AuthorAvatar({
  avatarId, size = 28, still = true,
}: {
  avatarId?: string | null
  size?: number
  still?: boolean
}) {
  const colors = useColors()
  const src = avatarSource(avatarId, still)
  const box = { width: size, height: size, borderRadius: size / 2 }

  // 캐릭터가 없는 작성자(옛 데이터·외부 후기)는 기본 사람 아이콘으로 자리를 맞춘다 —
  // 아예 안 그리면 줄마다 들여쓰기가 달라져 목록이 들쭉날쭉해진다.
  if (!src) {
    return (
      <View style={[box, styles.fallback, { backgroundColor: colors.surfaceHigh }]}>
        <Ionicons name="person" size={size * 0.55} color={colors.textTertiary} />
      </View>
    )
  }
  return <Image source={src} style={[box, { backgroundColor: colors.surfaceHigh }]} contentFit="cover" />
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
})
