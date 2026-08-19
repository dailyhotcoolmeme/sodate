import React from 'react'
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native'
import { Image } from 'expo-image'
import { track } from '@/lib/analytics'

// 게시글 행(PostRow)과 같은 좌우 여백(2026-08-13 오너 지시로 정해진 값).
const SIDE_PADDING = 16
// 배너 원본 1110×276 = 4:1. 카카오톡 친구탭 배너(약 5:1)를 재서 정한 비율에
// 문구 두 줄이 들어가도록 오너가 고른 값(2026-08-19).
const ASPECT = 1110 / 276

// 애니메이션 WebP — 화살표가 원 안으로 내려오고 테두리가 퍼지는, toolshere 로고 움직임
// 그대로다(오너 요청 2026-08-19). GIF 로도 만들어봤지만 256색이라 배경 보라 그라데이션이
// 뭉개지고 5.4MB 였다 — 같은 화질에서 WebP 가 148KB 로 37배 작아 이쪽을 쓴다.
// expo-image 가 애니메이션 WebP 를 그대로 재생한다.
const BANNER_URL = 'https://sodate-admin.pages.dev/media/promo/toolshere-banner-anim-v1.webp'
const TARGET_URL = 'https://toolshere.app'

/**
 * 커뮤니티 피드 맨 위 홍보 배너(2026-08-19 오너 지시).
 *
 * AdMob 광고가 아니라 우리가 만든 자체 배너다 — 같은 회사 서비스(Tools Here)를 알린다.
 * 디자인·문구는 toolshere.app/about-us 히어로에서 가져왔다.
 *
 * 이미지는 R2에 올려두고 URL로 불러온다(오너 선택). 나중에 배너를 바꿀 때 앱을 다시
 * 배포하지 않고 같은 키에 새 이미지만 덮으면 된다. 다만 그러면 캐시 때문에 옛 이미지가
 * 남을 수 있으니, 정말 바꿀 땐 파일명 뒤 -v2 처럼 올려서 이 상수를 갱신하는 쪽이 확실하다.
 *
 * 닫기 버튼은 두지 않는다(오너 지시) — 항상 보인다.
 */
export default function BoardPromoBanner() {
  const open = () => {
    track('promo_banner_tap', { properties: { target: 'toolshere' } })
    Linking.openURL(TARGET_URL).catch(() => {})
  }
  return (
    <View style={styles.wrap}>
      <TouchableOpacity onPress={open} activeOpacity={0.85} accessibilityRole="link">
        <Image
          source={{ uri: BANNER_URL }}
          style={styles.img}
          contentFit="cover"
          // 목록을 스크롤할 때마다 다시 받지 않도록 디스크까지 캐시한다.
          cachePolicy="memory-disk"
          transition={150}
          accessibilityLabel="Tools Here — 세상에 흩어진 모든 도구들이 모여 있는 곳"
        />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SIDE_PADDING, paddingTop: 12, paddingBottom: 4 },
  // 높이는 폭에서 자동으로 나온다 — 기기 폭이 달라도 비율이 안 깨진다.
  img: { width: '100%', aspectRatio: ASPECT, borderRadius: 12 },
})
