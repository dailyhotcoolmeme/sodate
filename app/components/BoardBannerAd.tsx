import React from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads'
import { getBoardBannerAdUnitId } from '@/lib/ads'
import { track } from '@/lib/analytics'

/**
 * 게시판 목록 맨 아래(페이지 번호 밑) 배너 광고(2026-08-13, 오너 지시).
 * 기존 피드·상세의 네이티브 광고와 별도로, AdMob에 새로 만든 배너 전용 광고 단위를 쓴다
 * (lib/ads.ts의 boardBanner). 로드 실패 시 자리를 차지하지 않게 아예 숨긴다.
 */
export default function BoardBannerAd() {
  const [failed, setFailed] = React.useState(false)
  const unitId = getBoardBannerAdUnitId()
  if (failed) return null
  return (
    <View style={styles.wrap}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.BANNER}
        onAdLoaded={() => track('ad_load_success', { properties: { slot: 'board_bottom', platform: Platform.OS, unit: unitId } })}
        onAdFailedToLoad={(e) => {
          setFailed(true)
          track('ad_load_fail', {
            properties: { slot: 'board_bottom', platform: Platform.OS, unit: unitId, code: (e as any)?.code ?? null },
          })
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 10 },
})
