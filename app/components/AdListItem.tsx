import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads'
import { Image } from 'expo-image'
import { useColors } from '@/hooks/useColors'
import { FEED_NATIVE_AD_UNIT_ID } from '@/lib/ads'

const THUMB = 88

// 광고 단위 ID는 @/lib/ads 에서 중앙 관리 (미설정 시 자동 테스트 광고 폴백)
const AD_UNIT_ID = FEED_NATIVE_AD_UNIT_ID

export default function AdListItem() {
  const colors = useColors()
  const [ad, setAd] = useState<NativeAd | null>(null)

  useEffect(() => {
    let mounted = true
    let loaded: NativeAd | null = null
    NativeAd.createForAdRequest(AD_UNIT_ID)
      .then((nativeAd) => {
        if (mounted) {
          loaded = nativeAd
          setAd(nativeAd)
        } else {
          nativeAd.destroy()
        }
      })
      .catch(() => {
        // 광고 로드 실패 시 슬롯을 비워둔다 (앱 동작엔 영향 없음)
      })
    return () => {
      mounted = false
      loaded?.destroy()
    }
  }, [])

  const styles = useMemo(() => StyleSheet.create({
    // 둥근 테두리는 일반 RN View가 담당 (NativeAdView는 네이티브뷰라 borderRadius 클리핑이 안 됨)
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginHorizontal: 16,
      marginVertical: 5,
      overflow: 'hidden',
    },
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
    <NativeAdView nativeAd={ad} style={styles.row}>
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
    </NativeAdView>
    </View>
  )
}
