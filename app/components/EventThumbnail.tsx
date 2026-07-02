import React, { useState } from 'react'
import { View, Text, StyleSheet, StyleProp, ViewStyle, ImageStyle } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'

// 이미지 없는 케이스 공통 규칙:
// - thumbnail_url이 없거나 / 로고·플레이스홀더 URL이거나 / 로딩 실패면
//   → 업체별 파스텔 배경 + 하트 배지 + 업체명의 "디자인된 폴백"을 보여준다.
// - 폰트는 고정 크기라 글자가 확대·왜곡되지 않는다.
// 카드/리스트/상세 어디서든 이 컴포넌트만 쓰면 동일하게 동작(향후 신규 업체도 자동).

const PALETTE = [
  { bg: '#FDE7EE', fg: '#D65A86', ic: '#F19DB8' }, // rose
  { bg: '#FFEBDD', fg: '#E07B45', ic: '#F4B189' }, // peach
  { bg: '#FFF3D4', fg: '#C99312', ic: '#E6C560' }, // butter
  { bg: '#E8F3EC', fg: '#4B9E6B', ic: '#95C9AB' }, // sage
  { bg: '#E7F0FB', fg: '#4A82C3', ic: '#9DBFE7' }, // sky
  { bg: '#F0E9FB', fg: '#7E5FC0', ic: '#B7A3E4' }, // lavender
  { bg: '#FCE8E5', fg: '#D25A4C', ic: '#F0A79D' }, // coral
  { bg: '#E9F1F0', fg: '#4E938C', ic: '#9AC7C1' }, // teal
]

function colorOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
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
  size?: 'large' | 'small'
}) {
  const [err, setErr] = useState(false)

  if (url && !err && !isBadThumb(url)) {
    return (
      <Image
        source={{ uri: url }}
        style={style as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={200}
        onError={() => setErr(true)}
      />
    )
  }

  const name = stripBrackets(companyName) || '소개팅'
  const c = colorOf(name)

  if (size === 'small') {
    return (
      <View style={[style, styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.initial, { color: c.fg }]} numberOfLines={1}>
          {name.slice(0, 2)}
        </Text>
      </View>
    )
  }

  return (
    <View style={[style, styles.center, { backgroundColor: c.bg }]}>
      <View style={[styles.badge, { backgroundColor: c.ic }]}>
        <Ionicons name="heart" size={24} color="#fff" />
      </View>
      <Text style={[styles.name, { color: c.fg }]} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.sub, { color: c.fg }]} numberOfLines={1}>
        {region ? `${region} · 소개팅` : '소개팅 모임'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  name: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  sub: { fontSize: 12, fontWeight: '600', opacity: 0.85, marginTop: 3 },
  initial: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
})
