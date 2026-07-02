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
import { NATIVE_AD_UNIT_ID } from '@/lib/ads'

const ICON = 44

// 광고 단위 ID는 @/lib/ads 에서 중앙 관리 (미설정 시 자동 테스트 광고 폴백)
const AD_UNIT_ID = NATIVE_AD_UNIT_ID

/**
 * 상세페이지 신청 버튼 바로 위에 들어가는 컴팩트 가로형 네이티브 광고.
 * CTA(신청하기)와 헷갈리지 않도록 외곽선형 + 회색 톤 + "광고" 배지로 명확히 구분한다.
 */
export default function AdBanner() {
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
      .catch(() => {})
    return () => {
      mounted = false
      loaded?.destroy()
    }
  }, [])

  const styles = useMemo(() => StyleSheet.create({
    // 외곽선형 카드 — primary 신청버튼과 색/형태로 확실히 구분
    card: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceHigh,
      marginBottom: 16, // 신청 버튼과 간격 확보 (실수 클릭 방지)
      overflow: 'hidden',
    },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      gap: 10,
    },
    icon: { width: ICON, height: ICON, borderRadius: 8, backgroundColor: colors.surface },
    info: { flex: 1, gap: 2 },
    advertiser: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
    headline: { fontSize: 13, color: colors.textPrimary, fontWeight: '700', lineHeight: 18 },
    body: { fontSize: 11, color: colors.textSecondary },
    cta: {
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: colors.textTertiary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    ctaText: { fontSize: 12, color: colors.textSecondary, fontWeight: '700' },
    adBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
      zIndex: 2,
    },
    adBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  }), [colors])

  if (!ad) return null

  return (
    <View style={styles.card}>
      {/* '광고' 명시 배지 (정책상 필수) */}
      <View style={styles.adBadge}>
        <Text style={styles.adBadgeText}>광고</Text>
      </View>
      <NativeAdView nativeAd={ad} style={styles.inner}>
        {ad.icon?.url ? (
          <Image source={{ uri: ad.icon.url }} style={styles.icon} contentFit="cover" />
        ) : ad.mediaContent ? (
          <NativeMediaView style={styles.icon} resizeMode="cover" />
        ) : (
          <View style={styles.icon} />
        )}

        <View style={styles.info}>
          <Text style={styles.advertiser} numberOfLines={1}>
            {ad.advertiser || 'Sponsored'}
          </Text>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.headline} numberOfLines={1}>{ad.headline}</Text>
          </NativeAsset>
          {!!ad.body && (
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={styles.body} numberOfLines={1}>{ad.body}</Text>
            </NativeAsset>
          )}
        </View>

        {!!ad.callToAction && (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>{ad.callToAction}</Text>
            </View>
          </NativeAsset>
        )}
      </NativeAdView>
    </View>
  )
}
