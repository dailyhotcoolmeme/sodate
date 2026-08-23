import React from 'react'
import { UIManager } from 'react-native'

/**
 * 게시글 동영상 재생(숨김 기능). expo-video 네이티브가 바이너리에 있을 때만 렌더(재빌드 후).
 * 없으면 아무것도 안 그림(현재 앱엔 영상 글 자체가 없음).
 */
export const VIDEO_NATIVE_AVAILABLE = !!UIManager.getViewManagerConfig?.('ExpoVideo')
let Impl: React.ComponentType<{ uri: string }> | null = null
if (VIDEO_NATIVE_AVAILABLE) Impl = require('./PostVideoImpl').default

export default function PostVideo({ urls }: { urls?: string[] | null }) {
  if (!Impl || !urls?.length) return null
  const P = Impl
  return <>{urls.map((u) => <P key={u} uri={u} />)}</>
}
