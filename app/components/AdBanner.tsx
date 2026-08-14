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
import { getDetailNativeAdUnitId } from '@/lib/ads'
import { track } from '@/lib/analytics'

// 구글 정책: 네이티브 광고 미디어 뷰의 가로·세로가 120 미만이면 수익화 대상에서 제외될 수 있음.
// 'thumb'는 120으로 키운 이미지형, 'text'는 이미지를 아예 안 그려서 그 기준 자체가 적용되지 않는 형태.
const THUMB = 120

type Variant = 'text' | 'thumb'

// 광고 단위 ID는 @/lib/ads 에서 중앙 관리 (미설정 시 자동 테스트 광고 폴백)
// 요청 시점에 계산 — 모듈 로드 시점엔 Updates.channel이 아직 없을 수 있다

/**
 * 상세페이지 신청 버튼 위에 들어가는 컴팩트 네이티브 광고.
 * CTA(신청하기)와 헷갈리지 않도록 외곽선형 + 회색 톤 + "광고" 배지로 명확히 구분한다.
 */
export default function AdBanner({ variant = 'thumb' }: { variant?: Variant }) {
  const colors = useColors()
  const [ad, setAd] = useState<NativeAd | null>(null)

  useEffect(() => {
    let mounted = true
    let loaded: NativeAd | null = null
    // 어떤 광고 단위로 나갔는지 남긴다 — 테스트 ID로 새는 실행을 구분하기 위함
    const unitId = getDetailNativeAdUnitId()
    NativeAd.createForAdRequest(unitId)
      .then((nativeAd) => {
        if (mounted) {
          loaded = nativeAd
          setAd(nativeAd)
          track('ad_load_success', { properties: { slot: 'detail', platform: Platform.OS, unit: unitId, variant } })
        } else {
          // 로드 완료 전에 화면을 벗어난 경우 — discarded로 구분해서 남긴다
          // (components/AdListItem.tsx와 동일한 이유, 2026-08-14).
          nativeAd.destroy()
          track('ad_load_success', { properties: { slot: 'detail', platform: Platform.OS, unit: unitId, variant, discarded: true } })
        }
      })
      .catch((e) => {
        // 조용히 삼키면 출시 후 광고가 안 나와도 알 수가 없다 — 사유를 남긴다
        track('ad_load_fail', {
          properties: {
            slot: 'detail',
            platform: Platform.OS,
            unit: unitId,
            variant,
            code: e?.code ?? null,
            message: String(e?.message ?? e).slice(0, 200),
          },
        })
      })
    return () => {
      mounted = false
      loaded?.destroy()
    }
  }, [variant])

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
    // iOS GADNativeAdView에 flex 직접 주면 자식이 우측하단 치우침 → 폭만 채우고 내부 View가 레이아웃
    nativeAdView: { width: '100%' },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      gap: 10,
    },
    icon: { width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: colors.surface },
    info: { flex: 1, gap: 3 },
    advertiser: { fontSize: 10, color: colors.textTertiary, fontWeight: '600' },
    headline: { fontSize: 13, color: colors.textPrimary, fontWeight: '700', lineHeight: 18 },
    body: { fontSize: 11, color: colors.textSecondary },
    cta: {
      alignSelf: 'flex-start',
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.textTertiary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    // text 변형은 이미지가 없어 카드가 좁으니 CTA를 헤드라인 옆으로 붙인다
    ctaInline: {
      alignSelf: 'center',
      marginTop: 0,
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
      <NativeAdView nativeAd={ad} style={styles.nativeAdView}>
        <View style={styles.inner}>
        {/* text 변형은 이미지 자체를 그리지 않는다 — 구글의 미디어 뷰 최소크기 기준(120) 대상이 아니게 된다 */}
        {variant === 'thumb' && (
          ad.icon?.url ? (
            <Image source={{ uri: ad.icon.url }} style={styles.icon} contentFit="cover" />
          ) : ad.mediaContent ? (
            <NativeMediaView style={styles.icon} resizeMode="cover" />
          ) : (
            <View style={styles.icon} />
          )
        )}

        <View style={styles.info}>
          <Text style={styles.advertiser} numberOfLines={1}>
            {ad.advertiser || 'Sponsored'}
          </Text>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.headline} numberOfLines={variant === 'thumb' ? 2 : 1}>{ad.headline}</Text>
          </NativeAsset>
          {!!ad.body && (
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={styles.body} numberOfLines={1}>{ad.body}</Text>
            </NativeAsset>
          )}
        </View>

        {/* 두 변형 모두 CTA는 info 옆에 나란히(세로로 안 쌓음) — text 변형이 이미지만 빠진 형태가 되게 */}
        {!!ad.callToAction && (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={[styles.cta, styles.ctaInline]}>
              <Text style={styles.ctaText}>{ad.callToAction}</Text>
            </View>
          </NativeAsset>
        )}
        </View>
      </NativeAdView>
    </View>
  )
}
