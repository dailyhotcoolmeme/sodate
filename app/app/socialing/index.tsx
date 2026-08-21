import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'

/**
 * 소셜링 탭 — 아직 준비 중 화면(2026-08-21). 4탭 껍데기 단계.
 * 실제 목록은 다음 단계에서 채운다(문토 크롤러 필터 확장).
 * NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
export default function SocialingScreen() {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.container}>
      <TopBar />
      <View style={styles.center}>
        <Ionicons name="sparkles-outline" size={40} color={colors.textTertiary} />
        <Text style={styles.title}>소셜링</Text>
        <Text style={styles.sub}>준비 중이에요. 곧 만나요!</Text>
      </View>
      <BottomNav current="socialing" />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
    title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 6 },
    sub: { fontSize: 14, color: colors.textSecondary },
  })
}
