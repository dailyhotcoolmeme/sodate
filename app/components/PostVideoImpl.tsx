import React from 'react'
import { View, StyleSheet } from 'react-native'
import { VideoView, useVideoPlayer } from 'expo-video'

/** 실제 재생(expo-video). PostVideo 가 네이티브 있을 때만 require. */
export default function PostVideoImpl({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false })
  return (
    <View style={styles.wrap}>
      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
    </View>
  )
}
const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginTop: 10 },
  video: { width: '100%', height: '100%' },
})
