import React, { useMemo, useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, Switch } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useNotificationStore } from '@/stores/notificationStore'
import { useProfileSheetStore } from '@/stores/profileSheetStore'

/**
 * 공용 상단 톱바 — 모든 화면 공통.
 * 왼쪽: (서브페이지면 뒤로) + 앱아이콘 + 소개팅모아
 * 오른쪽: (홈이면 필터) + 햄버거 메뉴
 */
export default function TopBar({
  showBack = false,
  onLogoPress,
  onBeforeNavigate,
  segment,
  noSafeTop = false,
  onBeforeLeave,
}: {
  showBack?: boolean
  onLogoPress?: () => void
  onBeforeNavigate?: () => void // 메뉴 이동 직전(예: 열린 모달 닫기)
  // 일정 ↔ 게시판 전환. 지금 있는 화면에 따라 알아서 정해지므로 보통 안 넘겨도 된다.
  // 심사 통과 후 토글로 교체함(2026-08-07, 오너 지시 — docs/BOARD_SPEC.md에 "통과 후에는
  // 자유롭게 다듬어도 된다"고 이미 명시돼 있었음).
  segment?: 'event' | 'board'
  /** pageSheet 모달 안에서 쓸 때. iOS는 시트가 이미 상태바 아래에서 시작해 위 여백이 필요 없다.
   *  Android는 presentationStyle="pageSheet"가 무시되고 풀스크린으로 뜨므로(RN이 iOS 전용으로만
   *  지원) 이 값과 무관하게 항상 insets.top을 준다 — 안 그러면 노치가 톱바를 가린다
   *  (2026-08-02 오너 지적: FilterSheet에서 안드로이드 노치가 톱바를 가림). */
  noSafeTop?: boolean
  /**
   * 이 화면을 떠나는 이동(일정/게시판 전환, 로고) 직전에 불린다. 받은 함수를 부르면
   * 이동하고, 안 부르면 그대로 머문다. 글쓰기처럼 쓰던 게 날아가는 화면에서 쓴다.
   */
  onBeforeLeave?: (proceed: () => void) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const [menuVisible, setMenuVisible] = useState(false)
  const unread = useNotificationStore((s) => s.unread)
  const refreshUnread = useNotificationStore((s) => s.refreshUnread)
  useEffect(() => {
    refreshUnread()
  }, [refreshUnread])

  // 톱바는 어느 화면에서나 같은 모양이어야 한다(2026-07-31 오너 지시).
  // 화면마다 넘겨주지 않아도 지금 경로를 보고 일정/게시판을 정한다.
  const routeSeg: 'event' | 'board' = segment ?? (pathname.startsWith('/board') ? 'board' : 'event')
  // router.replace 후 pathname이 실제로 바뀌기까지 한 박자 늦는다. 토글 value를 pathname에서만
  // 읽으면 "눌렀다 → 다음 렌더에서 아직 안 바뀐 pathname으로 원위치 → 진짜 전환되면 다시 이동"
  // 순서로 스위치가 한 번 왔다갔다 하는 게 보였다(2026-08-07 오너 지적). 눌렀을 때 목표 상태를
  // 낙관적으로 먼저 반영해 전환을 기다리지 않게 한다. onBeforeLeave가 막아서 실제로 이동하지
  // 않으면(글쓰기 중 이탈 확인 취소 등) 아예 세팅을 안 하므로 스위치는 제자리로 남는다.
  const [optimisticSeg, setOptimisticSeg] = useState<'event' | 'board' | null>(null)
  const seg: 'event' | 'board' = optimisticSeg ?? routeSeg

  /** 화면을 떠나는 이동. 화면이 막아둘 수 있다(글쓰기 등). */
  const leave = (go: () => void) => {
    if (onBeforeLeave) onBeforeLeave(go)
    else go()
  }

  const goSegment = (to: 'event' | 'board') => {
    if (seg === to) return
    onBeforeNavigate?.()
    leave(() => {
      setOptimisticSeg(to)
      router.replace(to === 'board' ? '/board' : '/')
    })
  }

  const styles = useMemo(() => StyleSheet.create({
    wrap: { backgroundColor: colors.background },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    left: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0, flexShrink: 1 },
    backBtn: { paddingRight: 2 },
    logoBtn: { flexDirection: 'row', alignItems: 'center' },
    // 하트+"소개팅모아"가 한 이미지로 된 워드마크(원본 1042x231 = 4.51:1).
    // 라이트·다크 양쪽에서 보이는 핑크 버전만 사용(검정/흰색은 한쪽에서 사라짐).
    // 소개팅|커뮤니티 알약(글자 14)과 덩치를 맞춘다. 원본 1042x231 = 4.51:1 이라
    // 높이 24 에 맞는 폭은 108 이다(2026-07-31 오너 지적).
    logoWordmark: { width: 108, height: 24 },
    // 일정 ↔ 게시판 전환. 예전엔 '소개팅|커뮤니티' 글자 알약이었는데(심사 중엔 심사자가
    // 눌러보게 하려고 일부러 글자를 남겨뒀었다 — docs/BOARD_SPEC.md), 통과 후 토글로 교체.
    // 켜짐=커뮤니티, 꺼짐=소개팅. 로고와 아이콘 사이에서 남는 폭을 쓰되, 좁은 화면에서는
    // 로고가 먼저 줄어들도록 로고에 flexShrink 를 뒀다.
    // RN Switch가 iOS에서 실제 스위치보다 측정 높이를 크게 잡는 경우가 있어(알려진 이슈),
    // alignItems:'center'로도 같은 줄의 로고·아이콘보다 위로 붕 뜨게 보였다(2026-08-08
    // 오너 지적). iOS만 살짝 아래로 내려 맞춘다.
    segSwitch: { marginHorizontal: 6, flexShrink: 0, marginTop: Platform.OS === 'ios' ? 4 : 0 },
    iconBtn: { padding: 6, borderRadius: 8 },
    rightIcons: { flexDirection: 'row', alignItems: 'center' },
    bellBadge: {
      position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15,
      paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' },
    menuCard: {
      position: 'absolute', right: 12, minWidth: 168,
      backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 6,
      borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    menuBadge: {
      marginLeft: 'auto', minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9,
      backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    },
    menuBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    menuItemText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  }), [colors])

  // 첫 줄만 화면에 따라 다르다. 메뉴가 통째로 바뀌면 '아까 있던 게 없어졌다'가 된다.
  const firstItem = seg === 'board'
    ? { label: '내가 쓴 글', icon: 'create-outline', action: () => router.push('/board/mine') }
    : { label: '내가 쓴 후기', icon: 'create-outline', action: () => router.push({ pathname: '/reviews', params: { tab: 'mine' } }) }

  const MENU: { label: string; icon: string; action: () => void; badge?: number }[] = [
    firstItem,
    ...(seg === 'board'
      ? [{ label: '차단 목록', icon: 'eye-off-outline', action: () => router.push('/board/blocked') }]
      : []),
    { label: '후기 모음', icon: 'chatbubble-ellipses-outline', action: () => router.push('/reviews') },
    { label: '관심 모임', icon: 'heart-outline', action: () => router.push('/favorites') },
    { label: '알림 설정', icon: 'notifications-outline', action: () => router.push('/alerts') },
    { label: '내 정보', icon: 'person-outline', action: () => useProfileSheetStore.getState().openSheet() },
    { label: '설정', icon: 'settings-outline', action: () => router.push('/settings') },
  ]

  return (
    <View style={[styles.wrap, { paddingTop: noSafeTop && Platform.OS === 'ios' ? 0 : insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.left}>
          {showBack && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.logoBtn} activeOpacity={0.7}
            // 게시판 안에서는 게시판 홈으로 간다. 로고를 눌렀다고 일정으로 튕기면
            // 쓰던 흐름이 끊긴다(2026-07-31 오너 지적).
            onPress={() => leave(onLogoPress ?? (() => router.replace(seg === 'board' ? '/board' : '/')))}>
            <Image
              source={require('../assets/logo-wordmark.png')}
              style={styles.logoWordmark}
              contentFit="contain"
              accessibilityLabel="소개팅모아"
            />
          </TouchableOpacity>
        </View>

        <Switch
          value={seg === 'board'}
          onValueChange={(v) => goSegment(v ? 'board' : 'event')}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
          style={styles.segSwitch}
          accessibilityRole="switch"
          accessibilityLabel="일정·커뮤니티 전환"
          accessibilityHint="켜면 커뮤니티, 끄면 소개팅 일정 화면으로 이동합니다"
          accessibilityState={{ checked: seg === 'board' }}
        />

        <View style={styles.rightIcons}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => { onBeforeNavigate?.(); router.push('/notifications') }}
            hitSlop={8}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)} hitSlop={8}>
            <Ionicons name="menu" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.menuCard, { top: insets.top + 48 }]}>
            {MENU.map((m) => (
              <TouchableOpacity key={m.label} style={styles.menuItem}
                onPress={() => { setMenuVisible(false); onBeforeNavigate?.(); m.action() }}>
                <Ionicons name={m.icon as any} size={18} color={colors.textSecondary} />
                <Text style={styles.menuItemText}>{m.label}</Text>
                {!!m.badge && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeText}>{m.badge > 99 ? '99+' : m.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}
