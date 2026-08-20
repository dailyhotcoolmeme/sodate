import React, { useMemo, useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, Animated } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useColors } from '@/hooks/useColors'
import { setBoardEntry } from '@/lib/boardEntry'
import { useNotificationStore } from '@/stores/notificationStore'
import { useProfileSheetStore } from '@/stores/profileSheetStore'

// 일정↔커뮤니티 토글 치수 — 바깥 테두리 높이(24)가 옆 "소개팅모아" 로고 높이(24)와
// 정확히 같아야 한다(2026-08-12 오너 지시). 시스템 Switch는 iOS에서 51x31 고정이라
// transform:scale로 흉내 내도 실측이 딱 안 맞아, 아예 자체 디자인 트랙+손잡이로 교체.
const SEG_BORDER_H = 24
const SEG_TRACK_W = 34
const SEG_TRACK_H = 18
const SEG_THUMB = 14
const SEG_THUMB_INSET = 2

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
  onSearchPress,
  showToggleTip = false,
  onCloseToggleTip,
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
  /** 주면 벨 아이콘 왼쪽에 돋보기 아이콘이 뜬다(2026-08-13, 지금은 게시판 목록 검색
   *  팝업 전용). 화면마다 다른 동작이라 TopBar가 직접 검색 상태를 갖지 않고 호출부에 위임. */
  onSearchPress?: () => void
  /** 토글 아래에 "토글 버튼으로 바로 올 수 있어요" 말풍선을 띄운다(2026-08-20 오너 지시).
   *  띄울지 말지는 커뮤니티 화면(app/board/index.tsx)이 판단해서 내려준다 — 여기서
   *  판단하지 않는 이유는 TopBar 가 모든 화면에 깔려 있어서다. 대신 토글의 실제 위치를
   *  아는 건 이쪽뿐이라 그리는 건 여기서 한다. */
  showToggleTip?: boolean
  onCloseToggleTip?: () => void
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

  // 손잡이 슬라이드 애니메이션(디자인 토글)
  const thumbAnim = useRef(new Animated.Value(seg === 'board' ? 1 : 0)).current
  useEffect(() => {
    Animated.timing(thumbAnim, {
      toValue: seg === 'board' ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start()
  }, [seg, thumbAnim])
  const thumbTranslate = thumbAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SEG_THUMB_INSET, SEG_TRACK_W - SEG_THUMB - SEG_THUMB_INSET],
  })

  const styles = useMemo(() => StyleSheet.create({
    // 말풍선이 톱바 밖(목록 위)까지 내려오므로 톱바가 아래 내용보다 위에 있어야 한다.
    // 커뮤니티 목록 맨 위에는 홍보 배너(BoardPromoBanner)가 있는데, 그건 ScrollView 안이라
    // 형제 순서상 톱바보다 나중에 그려진다 — 그냥 두면 배너가 말풍선을 덮는다(2026-08-20 오너 지적).
    // ⚠️ 안드로이드는 zIndex 만으로는 안 먹는다. elevation 을 같이 줘야 한다.
    wrap: { backgroundColor: colors.background, zIndex: 20, elevation: 20 },
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
    // 켜짐=커뮤니티, 꺼짐=소개팅. 시스템 Switch는 iOS에서 정확한 높이 지정이 안 돼(51x31
    // 고정, scale로만 흉내) 로고와 높이를 딱 맞추기 어려워 자체 디자인 트랙+손잡이로
    // 교체했다(2026-08-12 오너 지시). 바깥 테두리 높이를 로고 높이(24)와 정확히 맞춤.
    segSwitchWrap: {
      height: SEG_BORDER_H,
      marginLeft: 6, // 로고 글자와 테두리 사이 살짝 간격
      borderWidth: 1.5, borderColor: colors.primary, borderRadius: SEG_BORDER_H / 2,
      paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center',
    },
    segTrack: {
      width: SEG_TRACK_W, height: SEG_TRACK_H, borderRadius: SEG_TRACK_H / 2,
    },
    segThumb: {
      position: 'absolute', top: (SEG_TRACK_H - SEG_THUMB) / 2,
      width: SEG_THUMB, height: SEG_THUMB, borderRadius: SEG_THUMB / 2,
      backgroundColor: '#fff',
      shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
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
    // 커뮤니티 항목 강조(2026-08-20 오너 지시) — 다른 항목과 성격이 달라 눈에 띄어야 한다.
    // 위 구분선으로 '여기서부터 다른 것'을 먼저 알리고, 배경·글자색으로 한 번 더 준다.
    menuItemOn: {
      backgroundColor: `${colors.primary}18`,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    menuItemTextOn: { color: colors.primary, fontWeight: '700' },
    // ── 토글 안내 말풍선(2026-08-20 오너 지시) ──
    // 꼬리: 같은 색 정사각형을 45도 돌려 말풍선 위에 겹친다(별도 이미지 불필요).
    // left:'50%' + marginLeft 로 토글 정중앙을 가리키므로 로고 폭이 바뀌어도 안 어긋난다.
    tipTail: {
      position: 'absolute', top: SEG_BORDER_H + 2, left: '50%', marginLeft: -4.5,
      width: 9, height: 9, backgroundColor: colors.primary,
      transform: [{ rotate: '45deg' }], borderRadius: 1,
    },
    tipBubble: {
      // 토글 아래 10px. 꼬리(top +6, 45도라 대각선 약 12.7px)가 위로 4px 삐져나와
      // 말풍선과 자연스럽게 이어진다. 이 둘은 같이 움직여야 한다.
      position: 'absolute', top: SEG_BORDER_H + 10, left: 0,
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.primary, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 9,
      shadowColor: '#000', shadowOpacity: 0.20, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    tipText: { color: '#fff', fontSize: 14, letterSpacing: -0.3 },
    // 본문(흰색)과 확실히 갈리는 진한 와인색(오너 선택 2026-08-20 'B'안).
    // 대괄호까지 씌워 눌러야 할 곳임을 두 번 알린다.
    tipClose: { color: '#8C2049', fontSize: 13, fontWeight: '700' },
  }), [colors])

  // 첫 줄만 화면에 따라 다르다. 메뉴가 통째로 바뀌면 '아까 있던 게 없어졌다'가 된다.
  const firstItem = seg === 'board'
    ? { label: '내가 쓴 글', icon: 'create-outline', action: () => router.push('/board/mine') }
    : { label: '내가 쓴 후기', icon: 'create-outline', action: () => router.push({ pathname: '/reviews', params: { tab: 'mine' } }) }

  // 메뉴는 지금 있는 쪽(일정/커뮤니티)에 필요한 것만 보여준다(2026-08-12 오너 지시).
  // 후기 모음·관심 모임·알림 설정·내 정보는 전부 '모임' 쪽 기능이라 커뮤니티에서는 뺀다.
  // '설정'은 앱 전체 설정이라 양쪽에 둔다.
  const MENU: { label: string; icon: string; action: () => void; badge?: number; highlight?: boolean }[] = [
    firstItem,
    ...(seg === 'board'
      ? [{ label: '차단 목록', icon: 'eye-off-outline', action: () => router.push('/board/blocked') }]
      : [
          { label: '후기 모음', icon: 'chatbubble-ellipses-outline', action: () => router.push('/reviews') },
          { label: '관심 모임', icon: 'heart-outline', action: () => router.push('/favorites') },
          { label: '알림 설정', icon: 'notifications-outline', action: () => router.push('/alerts') },
          { label: '내 정보', icon: 'person-outline', action: () => useProfileSheetStore.getState().openSheet() },
        ]),
    { label: '설정', icon: 'settings-outline', action: () => router.push('/settings') },
    // 커뮤니티로 가는 세 번째 길(2026-08-20 오너 지시). 맨 아래에 강조해서 둔다.
    // 이미 커뮤니티에 있으면 뺀다 — 지금 있는 곳으로 가는 메뉴는 의미가 없다.
    // router.push 가 아니라 goSegment 를 쓴다: 토글·스와이프가 전부 replace 라
    // push 하면 뒤로가기 스택이 어긋나고, 전환 애니메이션(leave)도 그대로 재사용된다.
    ...(seg === 'board' ? [] : [{
      label: '커뮤니티',
      icon: 'people-outline',
      highlight: true,
      action: () => { setBoardEntry('menu'); goSegment('board') },
    }]),
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

          <View style={styles.segSwitchWrap}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                // 어떤 길로 커뮤니티에 들어왔는지 남긴다(lib/boardEntry.ts 참고).
                if (seg !== 'board') setBoardEntry('toggle')
                goSegment(seg === 'board' ? 'event' : 'board')
              }}
              // 커뮤니티(켜짐)는 진한 핑크(colors.primary), 모임 피드(꺼짐)는 무채색 회색 대신
              // 연한 핑크로(2026-08-14 오너 지시) — 톱바 어디서나 핑크 톤 하나로 통일.
              style={[styles.segTrack, { backgroundColor: seg === 'board' ? colors.primary : `${colors.primary}30` }]}
              accessibilityRole="switch"
              accessibilityLabel="일정·커뮤니티 전환"
              accessibilityHint="켜면 커뮤니티, 끄면 소개팅 일정 화면으로 이동합니다"
              accessibilityState={{ checked: seg === 'board' }}
            >
              <Animated.View style={[styles.segThumb, { transform: [{ translateX: thumbTranslate }] }]} />
            </TouchableOpacity>

            {/* 꼬리는 토글을 감싼 View 안에 둔다 — left:'50%' 로 토글 정중앙을 가리키므로
                로고 폭이나 여백이 바뀌어도 좌표를 다시 계산할 필요가 없다. */}
            {showToggleTip && <View style={styles.tipTail} />}
          </View>

          {/* 말풍선 본체는 로고+토글을 감싼 left 컨테이너 기준이라 left:0 이 곧 바 왼쪽
              여백(14)과 같은 자리다. 꼬리와 부모를 일부러 다르게 뒀다 — 한 부모에 두면
              둘 중 하나는 좌표를 손으로 계산해야 한다.
              토글을 가리지 않게 아래에만 둔다(보고 바로 눌러볼 수 있어야 한다). */}
          {showToggleTip && (
            <View style={styles.tipBubble}>
              <Text style={styles.tipText}>토글 버튼으로 바로 올 수 있어요</Text>
              <TouchableOpacity onPress={onCloseToggleTip} hitSlop={10} activeOpacity={0.7}>
                <Text style={styles.tipClose}>[닫기]</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.rightIcons}>
          {!!onSearchPress && (
            <TouchableOpacity style={styles.iconBtn} onPress={onSearchPress} hitSlop={8}>
              <Ionicons name="search-outline" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          )}

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
              <TouchableOpacity key={m.label} style={[styles.menuItem, m.highlight && styles.menuItemOn]}
                onPress={() => { setMenuVisible(false); onBeforeNavigate?.(); m.action() }}>
                <Ionicons name={m.icon as any} size={18} color={m.highlight ? colors.primary : colors.textSecondary} />
                <Text style={[styles.menuItemText, m.highlight && styles.menuItemTextOn]}>{m.label}</Text>
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
