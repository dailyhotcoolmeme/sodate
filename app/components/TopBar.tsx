import React, { useMemo, useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native'
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
  // ⚠️ 심사 통과 전까지 '커뮤니티' 글자가 보이는 형태를 유지할 것 — 아이콘만 남기면
  //    심사자가 눌러보지 않고, 눌러보지 않은 기능은 없는 것으로 본다(docs/BOARD_SPEC.md).
  segment?: 'event' | 'board'
  /** pageSheet 모달 안에서 쓸 때. 시트가 이미 상태바 아래에서 시작해 위 여백이 필요 없다 */
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
  const seg: 'event' | 'board' = segment ?? (pathname.startsWith('/board') ? 'board' : 'event')

  /** 화면을 떠나는 이동. 화면이 막아둘 수 있다(글쓰기 등). */
  const leave = (go: () => void) => {
    if (onBeforeLeave) onBeforeLeave(go)
    else go()
  }

  const goSegment = (to: 'event' | 'board') => {
    if (seg === to) return
    onBeforeNavigate?.()
    leave(() => router.replace(to === 'board' ? '/board' : '/'))
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
    // 일정 ↔ 게시판 전환. 로고와 아이콘 사이에서 남는 폭을 쓰되, 좁은 화면에서는
    // 로고가 먼저 줄어들도록 로고에 flexShrink 를 뒀다.
    segWrap: {
      flexDirection: 'row', borderRadius: 999, overflow: 'hidden',
      borderWidth: 1, borderColor: colors.border, marginHorizontal: 6, flexShrink: 0,
    },
    segBtn: { paddingHorizontal: 14, paddingVertical: 6, justifyContent: 'center' },
    segBtnOn: { backgroundColor: colors.primary },
    // lineHeight 를 명시해야 글자가 알약 안에서 위아래 가운데에 앉는다.
    segText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
    segTextOn: { color: '#fff', fontWeight: '800' },
    iconBtn: { padding: 6, borderRadius: 8 },
    filterBadge: {
      position: 'absolute', top: 0, right: 0, minWidth: 15, height: 15,
      paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    filterBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
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
    menuDot: {
      position: 'absolute', top: 5, right: 4,
      width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary,
    },
    menuItemText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  }), [colors])

  // 첫 줄만 화면에 따라 다르다. 메뉴가 통째로 바뀌면 '아까 있던 게 없어졌다'가 된다.
  const firstItem = seg === 'board'
    ? { label: '내가 쓴 글', icon: 'create-outline', action: () => router.push('/board/mine') }
    : { label: '내가 쓴 후기', icon: 'create-outline', action: () => router.push({ pathname: '/reviews', params: { tab: 'mine' } }) }

  const MENU: { label: string; icon: string; action: () => void; badge?: number }[] = [
    { label: '알림', icon: 'notifications-outline', action: () => router.push('/notifications'), badge: unread },
    firstItem,
    { label: '후기 모음', icon: 'chatbubble-ellipses-outline', action: () => router.push('/reviews') },
    { label: '관심 모임', icon: 'heart-outline', action: () => router.push('/favorites') },
    { label: '알림 설정', icon: 'notifications-outline', action: () => router.push('/alerts') },
    { label: '내 정보', icon: 'person-outline', action: () => useProfileSheetStore.getState().openSheet() },
    { label: '설정', icon: 'settings-outline', action: () => router.push('/settings') },
  ]

  return (
    <View style={[styles.wrap, { paddingTop: noSafeTop ? 0 : insets.top }]}>
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

        <View style={styles.segWrap}>
          <TouchableOpacity
            style={[styles.segBtn, seg === 'event' && styles.segBtnOn]}
            onPress={() => goSegment('event')}
            accessibilityRole="tab"
            accessibilityState={{ selected: seg === 'event' }}
          >
            <Text style={[styles.segText, seg === 'event' && styles.segTextOn]}>소개팅</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segBtn, seg === 'board' && styles.segBtnOn]}
            onPress={() => goSegment('board')}
            accessibilityRole="tab"
            accessibilityState={{ selected: seg === 'board' }}
          >
            <Text style={[styles.segText, seg === 'board' && styles.segTextOn]}>커뮤니티</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)}>
          <Ionicons name="menu" size={26} color={colors.textPrimary} />
          {/* 안 읽은 알림이 있으면 점만 찍는다. 숫자는 메뉴 안 '알림' 줄에서 보여준다. */}
          {unread > 0 && <View style={styles.menuDot} />}
        </TouchableOpacity>
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
