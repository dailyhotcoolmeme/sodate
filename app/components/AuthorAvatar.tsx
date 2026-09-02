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
 * ⚠️ 정지컷을 쓰지 않는다 — 이 캐릭터는 원래 천천히 움직이는 게 특징이라, 목록에서 멈춰
 * 있으면 그냥 그림이 된다(2026-09-03 오너 지적: "이거 서서히 움직이는거잖아").
 */
export default function AuthorAvatar({
  avatarId, size = 28,
}: {
  avatarId?: string | null
  size?: number
}) {
  const colors = useColors()
  const src = avatarSource(avatarId)
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
