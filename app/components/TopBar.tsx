import React, { useMemo, useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { useNotificationStore } from '@/stores/notificationStore'
import { useFilter } from '@/hooks/useFilter'
import { useProfileSheetStore } from '@/stores/profileSheetStore'

/**
 * 공용 상단 톱바 — 모든 화면 공통.
 * 왼쪽: (서브페이지면 뒤로) + 앱아이콘 + 소개팅모아
 * 오른쪽: (홈이면 필터) + 햄버거 메뉴
 */
export default function TopBar({
  showBack = false,
  onLogoPress,
  onFilterPress,
  filterCount = 0,
  onBeforeNavigate,
  segment,
  onSearchPress,
}: {
  showBack?: boolean
  onLogoPress?: () => void
  onFilterPress?: () => void
  filterCount?: number
  onBeforeNavigate?: () => void // 메뉴 이동 직전(예: 열린 모달 닫기)
  // 일정 ↔ 게시판 전환. 두 목록 화면에서만 준다(상세 화면에는 없음).
  // ⚠️ 심사 통과 전까지 '게시판' 글자가 보이는 형태를 유지할 것 — 아이콘만 남기면
  //    심사자가 눌러보지 않고, 눌러보지 않은 기능은 없는 것으로 본다(docs/BOARD_SPEC.md).
  segment?: 'event' | 'board'
  onSearchPress?: () => void // 게시판에서 필터 자리를 대신하는 검색
}) {
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const [menuVisible, setMenuVisible] = useState(false)
  const unread = useNotificationStore((s) => s.unread)
  const refreshUnread = useNotificationStore((s) => s.refreshUnread)
  useEffect(() => {
    refreshUnread()
  }, [refreshUnread])
  const { activeFilterCount } = useFilter()

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
    logoWordmark: { width: 122, height: 27 },
    logoWordmarkNarrow: { width: 96, height: 21 },
    right: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    // 일정 ↔ 게시판 전환. 로고와 아이콘 사이에서 남는 폭을 쓰되, 좁은 화면에서는
    // 로고가 먼저 줄어들도록 로고에 flexShrink 를 뒀다.
    segWrap: {
      flexDirection: 'row', borderRadius: 999, overflow: 'hidden',
      borderWidth: 1, borderColor: colors.border, marginHorizontal: 6, flexShrink: 0,
    },
    segBtn: { paddingHorizontal: 11, paddingVertical: 4 },
    segBtnOn: { backgroundColor: colors.primary },
    segText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
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
    menuItemText: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
  }), [colors])

  // 첫 줄만 화면에 따라 다르다. 메뉴가 통째로 바뀌면 '아까 있던 게 없어졌다'가 된다.
  const firstItem = segment === 'board'
    ? { label: '내가 쓴 글', icon: 'create-outline', action: () => router.push('/board/mine') }
    : { label: '내가 쓴 후기', icon: 'create-outline', action: () => router.push({ pathname: '/reviews', params: { tab: 'mine' } }) }

  const MENU: { label: string; icon: string; action: () => void }[] = [
    firstItem,
    { label: '후기 모음', icon: 'chatbubble-ellipses-outline', action: () => router.push('/reviews') },
    { label: '관심 모임', icon: 'heart-outline', action: () => router.push('/favorites') },
    { label: '알림 설정', icon: 'notifications-outline', action: () => router.push('/alerts') },
    { label: '내 정보', icon: 'person-outline', action: () => useProfileSheetStore.getState().openSheet() },
    { label: '설정', icon: 'settings-outline', action: () => router.push('/settings') },
  ]

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.left}>
          {showBack && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.logoBtn} activeOpacity={0.7}
            onPress={onLogoPress ?? (() => router.replace('/'))}>
            <Image
              source={require('../assets/logo-wordmark.png')}
              style={segment ? styles.logoWordmarkNarrow : styles.logoWordmark}
              contentFit="contain"
              accessibilityLabel="소개팅모아"
            />
          </TouchableOpacity>
        </View>

        {segment && (
          <View style={styles.segWrap}>
            <TouchableOpacity
              style={[styles.segBtn, segment === 'event' && styles.segBtnOn]}
              onPress={() => segment !== 'event' && router.replace('/')}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === 'event' }}
            >
              <Text style={[styles.segText, segment === 'event' && styles.segTextOn]}>일정</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segBtn, segment === 'board' && styles.segBtnOn]}
              onPress={() => segment !== 'board' && router.replace('/board')}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === 'board' }}
            >
              <Text style={[styles.segText, segment === 'board' && styles.segTextOn]}>게시판</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.right}>
          {/* 게시판에서는 걸러낼 조건이 없다 → 필터 자리를 검색이 대신한다. */}
          {segment === 'board' ? (
            <TouchableOpacity style={styles.iconBtn} onPress={onSearchPress}>
              <Ionicons name="search-outline" size={21} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onFilterPress ?? (() => router.push({ pathname: '/', params: { openFilter: '1' } }))}
          >
            <Ionicons name="funnel-outline" size={20} color={colors.textPrimary} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          )}
          {/* 알림 내역(종) — 필터-종-햄버거 */}
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
            {unread > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setMenuVisible(true)}>
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
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}
