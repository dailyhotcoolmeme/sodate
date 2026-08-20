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
// v2(2026-08-19): 12fps 는 화살표가 뚝뚝 끊겨 보여 24fps 로 올렸고, 루프 이음매가
// 튀지 않도록 파문 주기를 화살표와 같은 3.6초로 맞췄다. 문구를 줄인 덕에 프레임이
// 단순해져 오히려 140KB 로 더 작아졌다.
//
// ⚠️ v3(2026-08-19): 다크모드에서 네 귀퉁이에 흰 실선이 보였다(오너 제보). 배너를 굽는
//    banner.html 이 카드에 border-radius:36px 를 주면서 페이지 배경을 안 깔아, 둥근
//    모서리 **바깥** 삼각형이 브라우저 기본 흰색으로 사진에 찍혀 있었다. 아래 borderRadius
//    가 12pt 로 자르는데 구워진 반지름은 11.7pt(36px×0.3252) 라, 그 0.3pt 틈으로 흰색이
//    초승달처럼 살아남았다. 라이트모드에선 배경이 밝아 안 보이고 다크모드에서만 드러난다.
//    → 이미지에서 border-radius 를 아예 빼서 보라 카드가 1110×276 을 꽉 채우게 하고,
//      둥근 모서리는 이 컴포넌트의 borderRadius 가 전담한다. 이제 radius 를 얼마로 바꾸든
//      흰 테두리가 생길 수 없다. **배너를 다시 만들 때 이미지에 모서리를 굽지 말 것.**
const BANNER_URL = 'https://sodate-admin.pages.dev/media/promo/toolshere-banner-anim-v3.webp'
// 언어 없는 루트(toolshere.app)로 보내면 서버가 로케일을 판별해 /ko 로 한 번 더
// 넘긴다 — 그 왕복이 눈에 띄게 느려서 처음부터 /ko 로 보낸다(오너 지시 2026-08-20).
const TARGET_URL = 'https://toolshere.app/ko'

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
