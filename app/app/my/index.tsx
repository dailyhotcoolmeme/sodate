import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Linking, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useThemeStore } from '@/stores/themeStore'
import { useProfileSheetStore } from '@/stores/profileSheetStore'
import { useProfileStore } from '@/stores/profileStore'
import { useFavorites } from '@/hooks/useFavorites'
import { useMyPosts } from '@/hooks/useBoard'
import { getLastNickname } from '@/lib/reviewIdentity'

/**
 * MY 탭 — 개인 활동·설정을 한곳에 모은 화면(2026-08-21, 후배 검토 통과).
 * 통과 디자인 그대로: 상단 프로필(아바타+닉네임+나이·성별) + 통계 3분할(쓴 글·찜·받은 추천)
 * + 관심/내 활동/알림/설정 그룹. 서비스가 늘어도 "내 것"은 항상 여기 한 곳.
 *
 * 대부분 기존 화면을 라우팅한다(favorites/board.mine/alerts/board.blocked/reviews/privacy/terms).
 * 신규는 스크랩·최근 본 것 두 하위 화면과 다크모드 인라인 토글뿐. 톱바 햄버거는 이 개편에서 제거.
 *
 * ⚠️ NEW_TABS_ENABLED 가 false 인 동안은 이 화면으로 올 길이 없다(바텀 내비가 안 뜸).
 */
const APP_VERSION = '1.0.0'

function Row({
  icon, label, right, badge, onPress, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  right?: string
  badge?: string
  onPress?: () => void
  colors: AppColors
}) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.7 : 1}>
      <Ionicons name={icon} size={20} color={colors.textTertiary} style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      {badge && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      {right != null && <Text style={styles.rowRight}>{right}</Text>}
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
    </TouchableOpacity>
  )
}

export default function MyScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const router = useRouter()
  const { isDark, toggle } = useThemeStore()
  const openProfile = useProfileSheetStore((s) => s.openSheet)
  const { myAge, myGender } = useProfileStore()
  const { favoriteIds } = useFavorites()
  const { posts, refetch: refetchPosts } = useMyPosts()
  const [nickname, setNickname] = useState('')

  useFocusEffect(useCallback(() => {
    refetchPosts()
    getLastNickname().then((n) => setNickname(n || ''))
  }, [refetchPosts]))

  // 통계 — 쓴 글 수 / 관심(찜) 수 / 받은 추천 합
  const postCount = posts.length
  const favCount = favoriteIds.size
  const upvoteSum = posts.reduce((s, p) => s + (p.upvotes ?? 0), 0)

  const genderLabel = myGender === 'male' ? '남' : myGender === 'female' ? '여' : null
  const profileSub = [myAge ? `${myAge}세` : null, genderLabel].filter(Boolean).join(' · ') || '나이·성별 미설정'

  const contact = () =>
    Linking.openURL('mailto:admin@ourmine.co.kr').catch(() => Alert.alert('오류', '메일 앱을 열 수 없습니다'))

  return (
    <View style={styles.container}>
      <TopBar />
      <ScrollView
        style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* 프로필 요약 */}
        <TouchableOpacity style={styles.profile} activeOpacity={0.7} onPress={openProfile}>
          <View style={styles.avatar}><Ionicons name="person" size={26} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nickname}>{nickname || '게스트'}</Text>
            <Text style={styles.profileSub}>{profileSub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* 통계 3분할 */}
        <View style={styles.stats}>
          <TouchableOpacity style={styles.stat} activeOpacity={0.7} onPress={() => router.push('/board/mine')}>
            <Text style={styles.statNum}>{postCount}</Text><Text style={styles.statLabel}>쓴 글</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <TouchableOpacity style={styles.stat} activeOpacity={0.7} onPress={() => router.push('/favorites')}>
            <Text style={styles.statNum}>{favCount}</Text><Text style={styles.statLabel}>찜</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{upvoteSum}</Text><Text style={styles.statLabel}>받은 추천</Text>
          </View>
        </View>

        {/* 관심 */}
        <Text style={styles.grpLabel}>관심</Text>
        <Row colors={colors} icon="heart-outline" label="관심 일정" right={`소개팅·소셜링 ${favCount}`} onPress={() => router.push('/favorites')} />
        <Row colors={colors} icon="wine-outline" label="관심 매장" right="혼술바 0" onPress={() => router.push('/favorites')} />
        <Row colors={colors} icon="time-outline" label="최근 본 일정·매장" onPress={() => router.push('/my/recent')} />

        {/* 내 활동 */}
        <Text style={styles.grpLabel}>내 활동</Text>
        <Row colors={colors} icon="create-outline" label="내가 쓴 글·댓글" onPress={() => router.push('/board/mine')} />
        <Row colors={colors} icon="bookmarks-outline" label="스크랩한 글" badge="NEW" onPress={() => router.push('/my/scraps')} />
        <Row colors={colors} icon="star-outline" label="내가 쓴 후기" onPress={() => router.push({ pathname: '/reviews', params: { tab: 'mine' } })} />

        {/* 알림 */}
        <Text style={styles.grpLabel}>알림</Text>
        <Row colors={colors} icon="notifications-outline" label="알림 설정" right="관심 지역·태그" onPress={() => router.push('/alerts')} />
        <Row colors={colors} icon="ban-outline" label="차단 목록" onPress={() => router.push('/board/blocked')} />

        {/* 설정 */}
        <Text style={styles.grpLabel}>설정</Text>
        <View style={styles.row}>
          <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={colors.textTertiary} style={styles.rowIcon} />
          <Text style={styles.rowLabel}>다크 모드</Text>
          <Switch value={isDark} onValueChange={toggle} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
        </View>
        <Row colors={colors} icon="person-outline" label="내 정보" right="나이·성별" onPress={openProfile} />
        <Row colors={colors} icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
        <Row colors={colors} icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
        <Row colors={colors} icon="mail-outline" label="제휴문의" onPress={contact} />
        <Row colors={colors} icon="cube-outline" label="버전" right={APP_VERSION} />
      </ScrollView>
      <BottomNav current="my" />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // 프로필
    profile: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
    avatar: {
      width: 52, height: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    nickname: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    profileSub: { fontSize: 13, color: colors.textTertiary, marginTop: 3 },
    // 통계 3분할
    stats: {
      flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider, marginBottom: 4,
    },
    stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
    statDivider: { width: 1, backgroundColor: colors.divider, marginVertical: 10 },
    statNum: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    statLabel: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    // 그룹 라벨
    grpLabel: {
      fontSize: 12, fontWeight: '600', color: colors.textTertiary,
      textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4,
    },
    // 행
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
    rowIcon: { width: 26 },
    rowLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
    rowRight: { fontSize: 13, color: colors.textTertiary },
    badge: { backgroundColor: colors.primary, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  })
}
