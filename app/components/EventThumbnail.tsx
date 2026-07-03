import React, { useState } from 'react'
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native'
import { Image } from 'expo-image'
import { coverFor } from '@/constants/companyCovers'

// 이미지 없는 케이스 공통 규칙:
// - 이벤트 썸네일이 있으면(실제 사진) 그대로 보여준다.
// - 없거나 / 로고·플레이스홀더 URL / 로딩 실패면
//   → 업체별 "고정 배경 이미지" + 어두운 오버레이 + 강조 텍스트(업체명·지역)로 보여준다.
// 카드/리스트/상세 어디서든 이 컴포넌트만 쓰면 동일 동작(신규 업체도 자동).

const PASTEL = ['#2A2320', '#26221A', '#22201C', '#231F22', '#1F2422', '#221F26']
function bgOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PASTEL[h % PASTEL.length]
}

// 로고·플레이스홀더·1x1 등 "실제 사진이 아닌" 썸네일 URL 판별
function isBadThumb(url?: string | null): boolean {
  if (!url) return true
  const u = url.toLowerCase()
  return /placeholder|\/logo\/|logo_|width=1|height=1|blank|no[_-]?image|noimage|1x1|dummy/.test(u)
}

const stripBrackets = (s?: string | null) => (s || '').replace(/^\[[^\]]*\]\s*/, '').trim()

export default function EventThumbnail({
  url,
  companyName,
  region,
  style,
  size = 'large',
}: {
  url?: string | null
  companyName?: string | null
  region?: string | null
  style?: StyleProp<ViewStyle & ImageStyle>
  size?: 'large' | 'small' | 'detail'
}) {
  const [thumbErr, setThumbErr] = useState(false)
  const [coverErr, setCoverErr] = useState(false)

  // 1) 실제 이벤트 사진이 있으면 그대로
  if (url && !thumbErr && !isBadThumb(url)) {
    return (
      <Image
        source={{ uri: url }}
        style={style as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={200}
        onError={() => setThumbErr(true)}
      />
    )
  }

  // 2) 없으면 업체 고정 배경 + 오버레이
  const name = stripBrackets(companyName) || '소개팅'
  const cover = coverFor(companyName)
  const small = size === 'small'
  const detail = size === 'detail'

  return (
    <View style={[style, styles.wrap, { backgroundColor: bgOf(name) }]}>
      {!coverErr && (
        <Image
          source={{ uri: cover }}
          style={StyleSheet.absoluteFill as StyleProp<ImageStyle>}
          contentFit="cover"
          transition={250}
          onError={() => setCoverErr(true)}
        />
      )}
      {/* 어두운 오버레이 (하단 강조 — 네이티브 그라데이션 없이 2겹으로 근사) */}
      <View style={styles.scrimTop} />
      <View style={styles.scrimBottom} />

      {small ? (
        <Text style={styles.smallName} numberOfLines={2}>{name}</Text>
      ) : (
        <View style={styles.textWrap}>
          <Text style={[styles.name, detail && styles.nameDetail]} numberOfLines={1}>
            {name}
          </Text>
          {!!region && (
            <Text style={[styles.sub, detail && styles.subDetail]} numberOfLines={1}>
              {region} · 소개팅
            </Text>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', justifyContent: 'flex-end' },
  scrimTop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  scrimBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '62%',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  textWrap: { paddingHorizontal: 16, paddingBottom: 14 },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.4,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  nameDetail: { fontSize: 27 },
  sub: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.92)',
    marginTop: 3,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subDetail: { fontSize: 15, marginTop: 5 },
  smallName: {
    position: 'absolute',
    left: 7,
    right: 7,
    bottom: 7,
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
})
