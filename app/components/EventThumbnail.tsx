import React, { useState } from 'react'
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle, TextStyle } from 'react-native'
import { Image } from 'expo-image'
import { coverFor, ALWAYS_COVER } from '@/constants/companyCovers'

// 이미지 없는 케이스 공통 규칙:
// - 실제 이벤트 사진이 있으면 그대로.
// - 없거나 / 로고·플레이스홀더 / 로딩실패 / 로고전용 업체면
//   → 업체 고정 배경 + 어두운 오버레이 + "중앙 강조 텍스트(굵은 외곽선)".
// 카드/리스트/상세 공용. (다른 업체 포스터처럼 이미지 위 텍스트 강조)

const PASTEL = ['#2A2320', '#26221A', '#22201C', '#231F22', '#1F2422', '#221F26']
function bgOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PASTEL[h % PASTEL.length]
}

function isBadThumb(url?: string | null): boolean {
  if (!url) return true
  const u = url.toLowerCase()
  return /placeholder|\/logo\/|logo_|width=1|height=1|blank|no[_-]?image|noimage|1x1|dummy/.test(u)
}

const stripBrackets = (s?: string | null) => (s || '').replace(/^\[[^\]]*\]\s*/, '').trim()

const OUTLINE_DIRS: [number, number][] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2
  return [Math.cos(a), Math.sin(a)]
})

// RN은 글자 외곽선(stroke)이 없어 같은 글자를 8방향으로 겹쳐 두꺼운 테두리를 만든다.
function OutlinedText({
  children,
  style,
  ow = 2,
  color = 'rgba(0,0,0,0.92)',
}: {
  children: string
  style: StyleProp<TextStyle>
  ow?: number
  color?: string
}) {
  // 16방향 원형 배치로 매끄럽고 두꺼운 외곽선
  const dirs = OUTLINE_DIRS
  return (
    <View style={styles.otWrap}>
      {dirs.map(([dx, dy], i) => (
        <Text
          key={i}
          numberOfLines={1}
          style={[style, styles.otAbs, { left: dx * ow, top: dy * ow, color }]}
        >
          {children}
        </Text>
      ))}
      <Text numberOfLines={1} style={style}>{children}</Text>
    </View>
  )
}

export default function EventThumbnail({
  url,
  companyName,
  region,
  style,
  size = 'large',
  naturalRatio = false,
}: {
  url?: string | null
  companyName?: string | null
  region?: string | null
  style?: StyleProp<ViewStyle & ImageStyle>
  size?: 'large' | 'small' | 'detail'
  naturalRatio?: boolean   // 상세 히어로: 원본 비율 그대로(크롭 없이 전체 표시)
}) {
  const [thumbErr, setThumbErr] = useState(false)
  const [coverErr, setCoverErr] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)

  const forceCover = !!companyName && ALWAYS_COVER.has(companyName)

  // 1) 실제 이벤트 사진 (로고전용 업체는 건너뜀)
  if (!forceCover && url && !thumbErr && !isBadThumb(url)) {
    // 상세 히어로는 크롭 없이 원본 비율 그대로 — 세로 포스터 위/아래 안 잘림
    const heroStyle = naturalRatio
      ? [style, { aspectRatio: ratio ?? 4 / 3 }]
      : (style as StyleProp<ImageStyle>)
    return (
      <Image
        source={{ uri: url }}
        style={heroStyle as StyleProp<ImageStyle>}
        contentFit={naturalRatio ? 'contain' : 'cover'}
        transition={200}
        onLoad={naturalRatio ? (e) => {
          const w = e?.source?.width, h = e?.source?.height
          if (w && h) setRatio(w / h)
        } : undefined}
        onError={() => setThumbErr(true)}
      />
    )
  }

  // 2) 업체 고정 배경 + 중앙 강조 텍스트
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
      <View style={styles.scrim} />

      <OutlinedText
        style={[styles.name, small && styles.nameSmall, detail && styles.nameDetail]}
        ow={small ? 1.6 : 3}
      >
        {name}
      </OutlinedText>
      {!small && !!region && (
        <OutlinedText style={[styles.sub, detail && styles.subDetail]} ow={1.6}>
          {`${region} · 소개팅`}
        </OutlinedText>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  otWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  otAbs: { position: 'absolute' },
  name: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  nameSmall: { fontSize: 13 },
  nameDetail: { fontSize: 30 },
  sub: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    marginTop: 6,
    textAlign: 'center',
  },
  subDetail: { fontSize: 15, marginTop: 8 },
})
