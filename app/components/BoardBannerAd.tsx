import React, { useState } from 'react'
import { View, StyleSheet, Platform, LayoutChangeEvent } from 'react-native'
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads'
import { getBoardBannerAdUnitId } from '@/lib/ads'
import { track } from '@/lib/analytics'

// 게시글 행(PostRow)의 좌우 여백(paddingHorizontal: 16)과 똑같이 맞춘다(2026-08-13 오너 지시).
const SIDE_PADDING = 16

/**
 * 게시판 목록 맨 아래(페이지 번호 밑) 배너 광고(2026-08-13, 오너 지시).
 * 기존 피드·상세의 네이티브 광고와 별도로, AdMob에 새로 만든 배너 전용 광고 단위를 쓴다
 * (lib/ads.ts의 boardBanner).
 *
 * ⚠️ 처음엔 고정 크기(BannerAdSize.BANNER, 320x50)로 넣었는데, 게시글 좌우 여백과 안 맞고
 * 높이도 너무 얇았다(오너 지적). INLINE_ADAPTIVE_BANNER + width로 바꿔 실측한 컨테이너
 * 너비(게시글과 동일한 좌우 16px 여백 뺀 값)에 정확히 맞추고, 높이는 그 너비에 맞는
 * 적정값을 광고 SDK가 자동으로 더 크게 잡아준다.
 */
export default function BoardBannerAd() {
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(0)
  const unitId = getBoardBannerAdUnitId()

  // ⚠️(2026-08-13 오너 지적) 스크롤을 살짝만 움직여도 광고 자리에 빈 공간이 생겼다 —
  // onLayout은 스크롤 중 부모가 다시 렌더될 때마다 다시 불릴 수 있는데, 그때마다
  // width state가 갱신되면 BannerAd의 width prop이 바뀐 걸로 보여 네이티브 광고 뷰가
  // 다시 로드되면서 잠깐 빈 자리가 보였다. 처음 한 번만 측정해서 고정하고 그 뒤로는
  // 다시 안 바꾼다 — 광고가 스크롤 중에 다시 로드될 일이 없어진다.
  const onLayout = (e: LayoutChangeEvent) => {
    if (width > 0) return
    const w = Math.round(e.nativeEvent.layout.width) - SIDE_PADDING * 2
    if (w > 0) setWidth(w)
  }

  if (failed) return null
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 && (
        <BannerAd
          unitId={unitId}
          size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
          width={width}
          // maxHeight 안 주면 기기 높이까지 커질 수 있어(공식 문서), 기존 50px보다는
          // 확실히 크되 과하게 커지지 않게 100 정도로 눌러둔다.
          maxHeight={100}
          onAdLoaded={() => track('ad_load_success', { properties: { slot: 'board_bottom', platform: Platform.OS, unit: unitId } })}
          onAdFailedToLoad={(e) => {
            setFailed(true)
            track('ad_load_fail', {
              properties: { slot: 'board_bottom', platform: Platform.OS, unit: unitId, code: (e as any)?.code ?? null },
            })
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SIDE_PADDING, paddingTop: 10, paddingBottom: 20 },
})
