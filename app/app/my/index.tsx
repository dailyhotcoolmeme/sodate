import React, { useMemo } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Linking, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useThemeStore } from '@/stores/themeStore'
import { useProfileSheetStore } from '@/stores/profileSheetStore'

/**
 * MY 탭 — 개인 활동·설정을 한곳에 모은 화면(2026-08-21, 후배 검토 통과).
 * 서비스가 소개팅·소셜링·혼술바로 늘어나도 "내 것"은 항상 여기 한 곳에서 본다.
 *
 * 대부분은 기존에 톱바 햄버거로 흩어져 있던 화면을 그대로 라우팅한다(favorites/board.mine/
 * alerts/board.blocked/reviews/privacy/terms). 신규는 스크랩·최근 본 것 두 하위 화면과
 * 다크모드 인라인 토글뿐. 톱바 햄버거는 이 개편에서 제거하고 검색·종만 남긴다.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
const APP_VERSION = '1.0.0'

function Row({
  icon, label, badge, onPress, right, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  badge?: string
  onPress?: () => void
  right?: React.ReactNode
  colors: AppColors
}) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity
      style={styles.row} onPress={onPress}
      disabled={!onPress && !right} activeOpacity={onPress ? 0.7 : 1}
    >
      <Ionicons name={icon} size={20} color={colors.textTertiary} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      {right}
      {onPress && !right && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
    </TouchableOpacity>
  )
}

export default function MyScreen() {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { isDark, toggle } = useThemeStore()
  const openProfile = useProfileSheetStore((s) => s.openSheet)

  const contact = () =>
    Linking.openURL('mailto:admin@ourmine.co.kr').catch(() =>
      Alert.alert('오류', '메일 앱을 열 수 없습니다')
    )

  return (
    <View style={styles.container}>
      <TopBar />
      <ScrollView
        style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* 내 활동 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>내 활동</Text>
          <Row colors={colors} icon="bookmark-outline" label="관심 일정·매장" onPress={() => router.push('/favorites')} />
          <Row colors={colors} icon="time-outline" label="최근 본 것" onPress={() => router.push('/my/recent')} />
          <Row colors={colors} icon="create-outline" label="내가 쓴 글·댓글" onPress={() => router.push('/board/mine')} />
          <Row colors={colors} icon="bookmarks-outline" label="스크랩한 글" badge="NEW" onPress={() => router.push('/my/scraps')} />
          <Row colors={colors} icon="star-outline" label="내가 쓴 후기" onPress={() => router.push({ pathname: '/reviews', params: { tab: 'mine' } })} />
        </View>

        {/* 설정 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>설정</Text>
          <Row colors={colors} icon="notifications-outline" label="알림 설정" onPress={() => router.push('/alerts')} />
          <Row colors={colors} icon="ban-outline" label="차단 목록" onPress={() => router.push('/board/blocked')} />
          <Row
            colors={colors} icon={isDark ? 'moon' : 'sunny'} label="다크 모드"
            right={
              <Switch value={isDark} onValueChange={toggle}
                trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
            }
          />
          <Row colors={colors} icon="person-outline" label="내 정보 (나이·성별)" onPress={openProfile} />
        </View>

        {/* 정보 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>정보</Text>
          <Row colors={colors} icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
          <Row colors={colors} icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
          <Row colors={colors} icon="mail-outline" label="제휴문의" onPress={contact} />
          <Row colors={colors} icon="cube-outline" label="버전" right={<Text style={styles.versionText}>{APP_VERSION}</Text>} />
        </View>
      </ScrollView>
      <BottomNav current="my" />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    section: { paddingTop: 20, borderBottomWidth: 1, borderBottomColor: colors.divider },
    sectionTitle: {
      fontSize: 12, fontWeight: '600', color: colors.textTertiary,
      textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
    rowIcon: { width: 28 },
    rowLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
    badge: { backgroundColor: colors.primary, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    versionText: { fontSize: 13, color: colors.textTertiary },
  })
}
