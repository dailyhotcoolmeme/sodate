import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, Platform } from 'react-native'
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads'
import { Image } from 'expo-image'
import { useColors } from '@/hooks/useColors'
import { getFeedNativeAdUnitId } from '@/lib/ads'
import { track } from '@/lib/analytics'

const THUMB = 88

// 광고 단위 ID는 @/lib/ads 에서 중앙 관리 (미설정 시 자동 테스트 광고 폴백)
// 요청 시점에 계산 — 모듈 로드 시점엔 Updates.channel이 아직 없을 수 있다

export default function AdListItem({ slot = 'feed' }: { slot?: string }) {
  const colors = useColors()
  const [ad, setAd] = useState<NativeAd | null>(null)

  useEffect(() => {
    let mounted = true
    let loaded: NativeAd | null = null
    // 게시판 등 다른 슬롯도 당장은 피드와 같은 광고 단위를 재사용한다(리포트는 slot으로 구분).
    // AdMob에서 게시판 전용 네이티브 광고 단위를 만들면 @/lib/ads 에 추가해 이 슬롯만 바꿔 끼우면 된다.
    const unitId = getFeedNativeAdUnitId()
    NativeAd.createForAdRequest(unitId)
      .then((nativeAd) => {
        if (mounted) {
          loaded = nativeAd
          setAd(nativeAd)
        } else {
          nativeAd.destroy()
        }
        track('ad_load_success', { properties: { slot, platform: Platform.OS, unit: unitId } })
      })
      .catch((e) => {
        // 슬롯은 비워두고 앱은 그대로 돌아간다. 다만 예전처럼 조용히 삼키지는 않는다 —
        // 실패 사실과 사유를 남겨야 출시 후에 "광고가 왜 안 나오는지"를 알 수 있다.
        track('ad_load_fail', {
          properties: {
            slot,
            platform: Platform.OS,
            unit: unitId,
            code: e?.code ?? null,
            message: String(e?.message ?? e).slice(0, 200),
          },
        })
      })
    return () => {
      mounted = false
      loaded?.destroy()
    }
  }, [slot])

  const styles = useMemo(() => StyleSheet.create({
    // 둥근 테두리는 일반 RN View가 담당 (NativeAdView는 네이티브뷰라 borderRadius 클리핑이 안 됨)
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginHorizontal: 16,
      marginVertical: 5,
      overflow: 'hidden',
    },
    // iOS GADNativeAdView(네이티브뷰)에 flex를 직접 주면 자식이 우측하단으로 치우침 →
    // NativeAdView는 폭만 채우고, 실제 레이아웃은 내부 RN View(row)가 담당.
    nativeAdView: { width: '100%' },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 12,
      gap: 12,
    },
    thumbWrap: { position: 'relative' },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    adBadge: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 5,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    adBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
    info: { flex: 1, gap: 3 },
    advertiser: { fontSize: 11, color: colors.textTertiary, fontWeight: '600' },
    headline: { fontSize: 14, color: colors.textPrimary, fontWeight: '700', lineHeight: 20 },
    body: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    cta: {
      alignSelf: 'flex-start',
      marginTop: 6,
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    ctaText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  }), [colors])

  if (!ad) return null

  return (
    <View style={styles.card}>
    <NativeAdView nativeAd={ad} style={styles.nativeAdView}>
      <View style={styles.row}>
      {/* 썸네일 (광고 미디어) + '광고' 배지 */}
      <View style={styles.thumbWrap}>
        {ad.mediaContent ? (
          <NativeMediaView style={styles.thumb} resizeMode="cover" />
        ) : ad.icon?.url ? (
          <Image source={{ uri: ad.icon.url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={styles.thumb} />
        )}
        <View style={styles.adBadge}>
          <Text style={styles.adBadgeText}>광고</Text>
        </View>
      </View>

      {/* 내용 */}
      <View style={styles.info}>
        <Text style={styles.advertiser} numberOfLines={1}>
          {ad.advertiser || 'Sponsored'}
        </Text>
        <NativeAsset assetType={NativeAssetType.HEADLINE}>
          <Text style={styles.headline} numberOfLines={2}>{ad.headline}</Text>
        </NativeAsset>
        {!!ad.body && (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={styles.body} numberOfLines={1}>{ad.body}</Text>
          </NativeAsset>
        )}
        {!!ad.callToAction && (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>{ad.callToAction}</Text>
            </View>
          </NativeAsset>
        )}
      </View>
      </View>
    </NativeAdView>
    </View>
  )
}
