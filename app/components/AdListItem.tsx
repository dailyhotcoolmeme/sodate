import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, Platform, Dimensions } from 'react-native'
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads'
import { Image } from 'expo-image'
import { useColors } from '@/hooks/useColors'
import { getFeedNativeAdUnitId, claimPooledNativeAd } from '@/lib/ads'
import { track } from '@/lib/analytics'

// 구글 정책: 네이티브 광고 미디어 뷰의 가로·세로가 120 미만이면 수익화 대상에서 제외될 수 있음.
// 두 레이아웃을 번갈아 쓴다(index.tsx에서 광고 순번 % 2로 지정) — 'thumb'=지금 모양 유지,
// 'wide'=이미지를 카드 폭 전체로 키운 형태. 어느 쪽이든 120 기준은 충족한다.
const THUMB = 120
const WIDE_HEIGHT = 168
// NativeMediaView(구글 네이티브뷰)는 '100%' 같은 퍼센트 width를 못 받는다 — 내용 크기만큼만
// 잡히고 height는 그대로 강제돼 세로로 길쭉해진다(실기기에서 확인됨). 카드 좌우 여백(16×2)을
// 뺀 실제 픽셀 값을 직접 계산해서 넘긴다.
const CARD_MARGIN = 16
const WIDE_WIDTH = Dimensions.get('window').width - CARD_MARGIN * 2

type Variant = 'thumb' | 'wide'

// 광고 단위 ID는 @/lib/ads 에서 중앙 관리 (미설정 시 자동 테스트 광고 폴백)
// 요청 시점에 계산 — 모듈 로드 시점엔 Updates.channel이 아직 없을 수 있다

// ⚠️(2026-08-26) 소셜링·혼술바 피드에도 소개팅과 같은 방식으로 광고를 붙이면서, 리포트를
// 섹션별로 나누려고 애드몹에 전용 네이티브 광고 단위를 새로 만들었다(오너 지시 — "재사용하지
// 말고 새로 붙이라고"). adUnitId를 안 넘기면 기존과 동일하게 소개팅 피드 단위를 쓴다.
export default function AdListItem({ slot = 'feed', variant = 'thumb', adUnitId }: { slot?: string; variant?: Variant; adUnitId?: string }) {
  const colors = useColors()
  const [ad, setAd] = useState<NativeAd | null>(null)

  useEffect(() => {
    let mounted = true
    let owned: NativeAd | null = null
    const unitId = adUnitId ?? getFeedNativeAdUnitId()

    // 미리 채워둔 풀에서 즉시 꺼내 쓴다(lib/ads.ts 참고) — 네트워크 왕복 없이 반영되므로
    // 이 행이 스크롤로 화면 밖에 밀려 언마운트되기 전에 뜰 확률이 훨씬 높다.
    const pooled = claimPooledNativeAd(unitId, slot)
    if (pooled) {
      owned = pooled
      setAd(pooled)
    } else {
      // 세션 시작 직후 등 풀이 아직 안 찼으면 그 자리에서 즉석 요청(예전 방식)으로 폴백.
      NativeAd.createForAdRequest(unitId)
        .then((nativeAd) => {
          if (mounted) {
            owned = nativeAd
            setAd(nativeAd)
            track('ad_load_success', { properties: { slot, platform: Platform.OS, unit: unitId } })
          } else {
            // 로드는 됐지만 그새 이 행이 언마운트돼 화면에 못 뿌리고 바로 버리는 경우.
            // 예전엔 이것도 무조건 'ad_load_success'로 찍혀서 "로드는 다 성공하는데 왜
            // 화면엔 안 보이나"를 분간할 수 없었다(2026-08-14 오너 지적으로 발견) —
            // discarded 표시로 구분해서 실측 가능하게 남긴다.
            nativeAd.destroy()
            track('ad_load_success', { properties: { slot, platform: Platform.OS, unit: unitId, discarded: true } })
          }
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
    }
    return () => {
      mounted = false
      owned?.destroy()
    }
  }, [slot, adUnitId])

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
    // NativeAdView는 폭만 채우고, 실제 레이아웃은 내부 RN View가 담당.
    nativeAdView: { width: '100%' },

    // ── thumb 레이아웃(A안): 지금 모양 그대로, 이미지만 120으로 ──
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 12,
      gap: 12,
    },
    thumbWrap: { position: 'relative' },
    thumb: { width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: colors.surfaceHigh },
    info: { flex: 1, gap: 3 },

    // ── wide 레이아웃(B안): 이미지를 카드 폭 전체로 ──
    // NativeAdView(구글 네이티브뷰)는 직계 자식이 둘 이상이면 레이아웃을 제대로 못 잡는다
    // (이미지가 왼쪽에 좁게, 오른쪽이 빈 채로 나옴 — 실기기 확인). thumb 레이아웃처럼
    // 직계 자식을 하나(wideOuter)로 묶고 그 안에서 세로로 쌓는다.
    wideOuter: { width: WIDE_WIDTH },
    // NativeMediaView는 style로 width/height를 줘도 자체 계산한 크기로 그려질 때가 있다
    // (실기기에서 세로로 좁게 나옴 — 크기를 못 받는 것으로 재현). 크기가 고정된 래퍼 안에
    // absolute로 꽉 채워서 NativeMediaView 자신의 크기 계산을 무시하게 만든다.
    wideMediaWrap: { position: 'relative', width: WIDE_WIDTH, height: WIDE_HEIGHT, overflow: 'hidden' },
    wideMedia: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surfaceHigh },
    wideBody: { padding: 12, gap: 3 },
    wideBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    wideTextCol: { flex: 1, gap: 2 },

    adBadge: {
      position: 'absolute',
      top: 8,
      left: 8,
      backgroundColor: 'rgba(0,0,0,0.6)',
      borderRadius: 5,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    adBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
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
    ctaTight: { marginTop: 0 },
    ctaText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  }), [colors])

  if (!ad) return null

  const media = ad.mediaContent ? (
    <NativeMediaView style={variant === 'wide' ? styles.wideMedia : styles.thumb} resizeMode="cover" />
  ) : ad.icon?.url ? (
    <Image source={{ uri: ad.icon.url }} style={variant === 'wide' ? styles.wideMedia : styles.thumb} contentFit="cover" />
  ) : (
    <View style={variant === 'wide' ? styles.wideMedia : styles.thumb} />
  )

  if (variant === 'wide') {
    return (
      <View style={styles.card}>
        <NativeAdView nativeAd={ad} style={styles.nativeAdView}>
          <View style={styles.wideOuter}>
            <View style={styles.wideMediaWrap}>
              {media}
              <View style={styles.adBadge}>
                <Text style={styles.adBadgeText}>광고</Text>
              </View>
            </View>
            <View style={styles.wideBody}>
              <Text style={styles.advertiser} numberOfLines={1}>
                {ad.advertiser || 'Sponsored'}
              </Text>
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text style={styles.headline} numberOfLines={1}>{ad.headline}</Text>
              </NativeAsset>
              <View style={styles.wideBottom}>
                <View style={styles.wideTextCol}>
                  {!!ad.body && (
                    <NativeAsset assetType={NativeAssetType.BODY}>
                      <Text style={styles.body} numberOfLines={1}>{ad.body}</Text>
                    </NativeAsset>
                  )}
                </View>
                {!!ad.callToAction && (
                  <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                    <View style={[styles.cta, styles.ctaTight]}>
                      <Text style={styles.ctaText}>{ad.callToAction}</Text>
                    </View>
                  </NativeAsset>
                )}
              </View>
            </View>
          </View>
        </NativeAdView>
      </View>
    )
  }

  return (
    <View style={styles.card}>
    <NativeAdView nativeAd={ad} style={styles.nativeAdView}>
      <View style={styles.row}>
      {/* 썸네일 (광고 미디어) + '광고' 배지 */}
      <View style={styles.thumbWrap}>
        {media}
        <View style={[styles.adBadge, { top: 4, left: 4 }]}>
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
