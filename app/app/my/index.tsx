import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Linking, Alert, Modal, Pressable, TextInput } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import BottomNav from '@/components/BottomNav'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useThemeStore } from '@/stores/themeStore'
import { useProfileStore } from '@/stores/profileStore'
import { useFavoriteEvents } from '@/hooks/useFavorites'
import { usePlaceFavorites } from '@/stores/placeFavoriteStore'
import { useMyPosts, useMyComments } from '@/hooks/useBoard'
import { ensureNickname, setLastNickname, generateNickname, getMyReviewIds } from '@/lib/reviewIdentity'
import { getScrappedIds, getBlockedAuthors } from '@/lib/boardIdentity'
import { useAvatarStore } from '@/stores/avatarStore'
import { getAvatar, randomAvatarId } from '@/lib/avatars'
import AvatarPicker from '@/components/AvatarPicker'

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
  const { myAge, myGender, setMyAge, setMyGender } = useProfileStore()
  const { events: favEvents, refetch: refetchFavs } = useFavoriteEvents()
  const { favoriteIds: placeFavoriteIds } = usePlaceFavorites()
  const { posts, refetch: refetchPosts } = useMyPosts()
  const { comments, refetch: refetchComments } = useMyComments()
  const [nickname, setNickname] = useState('')
  // 로컬 저장 기반 카운트(스크랩·후기·차단) — 진입할 때마다 새로 읽는다.
  const [scrapCount, setScrapCount] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [blockedCount, setBlockedCount] = useState(0)
  // 닉네임 편집(전 서비스 공용 — 여기서만 바꾼다). 각 작성화면엔 닉네임칸 없음.
  const [nickEdit, setNickEdit] = useState(false)
  const [nickDraft, setNickDraft] = useState('')
  // 프로필 아바타(움직이는 thumbs) — 선택값은 avatarStore에 저장, 첫 실행 시 랜덤 자동 배정.
  const { avatarId, setAvatarId } = useAvatarStore()
  const avatar = getAvatar(avatarId)
  const [avatarPick, setAvatarPick] = useState(false)
  // 내 정보(나이·성별) 편집 — 바텀시트 대신 팝업. 닉네임 밑 보조 설정.
  const [profEdit, setProfEdit] = useState(false)
  const [ageDraft, setAgeDraft] = useState('')
  const [genderDraft, setGenderDraft] = useState<'male' | 'female' | null>(null)

  useFocusEffect(useCallback(() => {
    refetchPosts()
    refetchComments()
    refetchFavs()
    // 닉네임 없으면 자동 생성해 저장(최초 진입 시 1회).
    ensureNickname().then((n) => setNickname(n || ''))
    // 아바타 없거나 유효하지 않으면 랜덤 자동 배정(빈 이미지 없이 바로 캐릭터). 이후 사용자가 변경.
    if (!getAvatar(useAvatarStore.getState().avatarId)) setAvatarId(randomAvatarId())
    getScrappedIds().then((s) => setScrapCount(s.size))
    getMyReviewIds().then((ids) => setReviewCount(ids.length))
    getBlockedAuthors().then((b) => setBlockedCount(b.length))
  }, [refetchPosts, refetchComments, refetchFavs]))

  const openProfEdit = () => { setAgeDraft(myAge ? String(myAge) : ''); setGenderDraft(myGender); setProfEdit(true) }
  const saveProf = () => {
    const age = parseInt(ageDraft, 10)
    setMyAge(!isNaN(age) && age > 0 && age < 100 ? age : null)
    setMyGender(genderDraft)
    setProfEdit(false)
  }

  const openNickEdit = () => { setNickDraft(nickname); setNickEdit(true) }
  const saveNick = async () => {
    const v = nickDraft.trim()
    if (v.length < 2 || v.length > 20) { Alert.alert('알림', '닉네임은 2~20자로 입력해주세요.'); return }
    await setLastNickname(v)
    setNickname(v)
    setNickEdit(false)
  }

  // 관심 — 소개팅/소셜링/혼술바 각각 카운트
  const datingFavCount = favEvents.filter((e: any) => e.event_type !== 'socialing').length
  const socialingFavCount = favEvents.filter((e: any) => e.event_type === 'socialing').length
  const placeFavCount = placeFavoriteIds.size
  const postCount = posts.length
  const commentCount = comments.length

  const genderLabel = myGender === 'male' ? '남' : myGender === 'female' ? '여' : null
  const profileSub = [myAge ? `${myAge}세` : null, genderLabel].filter(Boolean).join(' · ') || '나이·성별 미설정'

  return (
    <View style={styles.container}>
      <TopBar />
      <ScrollView
        style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        {/* 프로필 요약 — 닉네임 탭=닉네임 편집(전 서비스 공용), 나이·성별 탭=내 정보 시트 */}
        <View style={styles.profile}>
          <TouchableOpacity style={[styles.avatar, avatar && styles.avatarImg]} activeOpacity={0.7} onPress={() => setAvatarPick(true)}>
            {avatar
              ? <Image source={avatar.source} style={styles.avatarPhoto} contentFit="cover" />
              : <Ionicons name="person" size={26} color="#fff" />}
            <View style={styles.avatarEdit}><Ionicons name="camera" size={12} color="#fff" /></View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TouchableOpacity style={styles.nickRow} activeOpacity={0.7} onPress={openNickEdit}>
              <Text style={styles.nickname}>{nickname || '닉네임 설정'}</Text>
              <Ionicons name="pencil" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} onPress={openProfEdit}>
              <Text style={styles.profileSub}>{profileSub} ›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 관심 — 즐겨찾기·최근 본 기록 각각 진입하면 소개팅·소셜링·혼술바 탭으로 나뉜다 */}
        <Text style={styles.grpLabel}>관심</Text>
        <Row colors={colors} icon="bookmark" label="즐겨찾기" right={`${datingFavCount + socialingFavCount + placeFavCount}`} onPress={() => router.push('/favorites')} />
        <Row colors={colors} icon="time-outline" label="최근 본 기록" onPress={() => router.push('/my/recent')} />

        {/* 내 활동 */}
        <Text style={styles.grpLabel}>내 활동</Text>
        <Row colors={colors} icon="create-outline" label="내가 쓴 글·댓글" right={`글 ${postCount} · 댓글 ${commentCount}`} onPress={() => router.push('/board/mine')} />
        <Row colors={colors} icon="bookmarks-outline" label="스크랩한 글" right={`${scrapCount}`} onPress={() => router.push('/my/scraps')} />
        <Row colors={colors} icon="star-outline" label="내가 쓴 후기" right={`${reviewCount}`} onPress={() => router.push('/my/reviews')} />
        <Row colors={colors} icon="ban-outline" label="차단 목록" right={`${blockedCount}`} onPress={() => router.push('/board/blocked')} />

        {/* 설정 — 알림·다크모드·내 정보·약관을 한 그룹으로 */}
        <Text style={styles.grpLabel}>설정</Text>
        <Row colors={colors} icon="notifications-outline" label="알림 설정" right="관심 지역·태그" onPress={() => router.push('/alerts')} />
        <View style={styles.row}>
          <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={colors.textTertiary} style={styles.rowIcon} />
          <Text style={styles.rowLabel}>다크 모드</Text>
          <Switch value={isDark} onValueChange={toggle} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
        </View>
        <Row colors={colors} icon="shield-checkmark-outline" label="개인정보처리방침" onPress={() => router.push('/privacy')} />
        <Row colors={colors} icon="document-text-outline" label="이용약관" onPress={() => router.push('/terms')} />
        {/* 예전엔 빈 메일이 바로 열렸다 — 안내 화면을 먼저 보여준다(2026-09-01 오너 지시). */}
        <Row colors={colors} icon="mail-outline" label="제휴문의" onPress={() => router.push('/partner')} />
        <Row colors={colors} icon="cube-outline" label="버전" right={APP_VERSION} />
      </ScrollView>
      <BottomNav current="my" />

      {/* 닉네임 편집 — 여기서 바꾸면 커뮤·소개팅·소셜링·혼술바 글/후기에 모두 적용된다. */}
      <Modal visible={nickEdit} transparent animationType="fade" onRequestClose={() => setNickEdit(false)} statusBarTranslucent>
        <View style={styles.mOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setNickEdit(false)} />
          <View style={styles.mCard}>
            <Text style={styles.mTitle}>닉네임 설정</Text>
            <Text style={styles.mSub}>글·후기에 함께 쓰이는 공용 닉네임이에요.</Text>
            <View style={styles.mInputRow}>
              <TextInput
                style={styles.mInput}
                value={nickDraft}
                onChangeText={setNickDraft}
                placeholder="2~20자"
                placeholderTextColor={colors.textTertiary}
                maxLength={20}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.mDice} onPress={() => setNickDraft(generateNickname())} activeOpacity={0.7}>
                <Ionicons name="dice-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.mDiceText}>랜덤</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.mBtns}>
              <TouchableOpacity style={styles.mCancel} onPress={() => setNickEdit(false)}><Text style={styles.mCancelText}>취소</Text></TouchableOpacity>
              <TouchableOpacity style={styles.mSave} onPress={saveNick}><Text style={styles.mSaveText}>저장</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 내 정보(나이·성별) 편집 — 팝업. 설정하면 나에게 맞는 이벤트만 보여준다. */}
      <Modal visible={profEdit} transparent animationType="fade" onRequestClose={() => setProfEdit(false)} statusBarTranslucent>
        <View style={styles.mOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setProfEdit(false)} />
          <View style={styles.mCard}>
            <Text style={styles.mTitle}>내 정보</Text>
            <Text style={styles.mSub}>설정하면 나에게 맞는 소개팅·소셜링만 보여드려요.</Text>
            <Text style={styles.mFieldLabel}>나이</Text>
            <View style={styles.mInputRow}>
              <TextInput
                style={styles.mInput}
                value={ageDraft}
                onChangeText={setAgeDraft}
                placeholder="나이 입력 (예: 28)"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                maxLength={2}
              />
              {ageDraft !== '' && (
                <TouchableOpacity style={styles.mDice} onPress={() => setAgeDraft('')} activeOpacity={0.7}>
                  <Text style={styles.mDiceText}>초기화</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.mFieldLabel}>성별</Text>
            <View style={styles.mGenderRow}>
              {(['male', 'female'] as const).map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.mGenderBtn, genderDraft === g && styles.mGenderBtnOn]}
                  onPress={() => setGenderDraft(genderDraft === g ? null : g)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mGenderText, genderDraft === g && styles.mGenderTextOn]}>
                    {g === 'male' ? '남성' : '여성'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.mBtns}>
              <TouchableOpacity style={styles.mCancel} onPress={() => setProfEdit(false)}><Text style={styles.mCancelText}>취소</Text></TouchableOpacity>
              <TouchableOpacity style={styles.mSave} onPress={saveProf}><Text style={styles.mSaveText}>저장</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 프로필 아바타 선택(동물 캐릭터 20종) */}
      <AvatarPicker visible={avatarPick} onClose={() => setAvatarPick(false)} />
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
    avatarImg: { backgroundColor: 'transparent' },
    avatarPhoto: { width: 52, height: 52, borderRadius: 999 },
    avatarEdit: {
      position: 'absolute', right: -1, bottom: -1, width: 20, height: 20, borderRadius: 999,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: colors.background,
    },
    nickRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    nickname: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    profileSub: { fontSize: 13, color: colors.textTertiary, marginTop: 3 },
    // 닉네임 편집 모달
    mOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    mCard: { width: '100%', maxWidth: 360, borderRadius: 16, backgroundColor: colors.surface, padding: 18, gap: 10 },
    mTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    mSub: { fontSize: 12.5, color: colors.textTertiary, marginTop: -4 },
    mInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    mInput: { flex: 1, minWidth: 0, backgroundColor: colors.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border },
    mDice: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
    mDiceText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    mFieldLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
    mGenderRow: { flexDirection: 'row', gap: 10 },
    mGenderBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceHigh },
    mGenderBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
    mGenderText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
    mGenderTextOn: { color: colors.primary },
    mBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
    mCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.surfaceHigh },
    mCancelText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
    mSave: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: colors.primary },
    mSaveText: { fontSize: 15, fontWeight: '800', color: '#fff' },
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
