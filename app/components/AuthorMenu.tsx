import React, { useMemo } from 'react'
import { View, Text, StyleSheet, Modal, Pressable, Dimensions } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'

/**
 * 닉네임을 누르면 그 자리에 뜨는 작은 메뉴 — '게시글 보기' / '댓글 보기'.
 *
 * 2026-08-19 오너 지적: 닉네임을 누르자마자 작성자 화면이 통째로 열리면 안 된다.
 * 글을 읽다 닉네임에 손이 스치기만 해도 화면이 바뀌어 버리고, 사용자가 무엇을 보러
 * 가는지 고르지도 못한 채 끌려간다. 눌렀을 때는 무엇을 할지 물어보고, 고른 다음에
 * 이동한다.
 *
 * 위치는 누른 지점(pageX/pageY) 기준이다. 중첩 <Text onPress> 는 자기 좌표를 재기가
 * 마땅치 않은데, 터치 이벤트가 pageX/pageY 를 그대로 준다. 화면 밖으로 넘치면
 * 안쪽으로 끌어당긴다.
 */
/**
 * 이 기능 전체를 켜고 끄는 스위치. **여기 하나만 true 로 바꾸면 다시 열린다.**
 *
 * 2026-08-20 오너 지시로 일단 숨긴다("추후에 다시 오픈할거야"). 코드는 지우지 않고
 * 그대로 둔다 — 화면(app/board/author/[token].tsx), 훅(useAuthorActivity), 이 메뉴,
 * 라우트 등록까지 전부 살아 있고 이 값만 false 다.
 *
 * false 인 동안:
 *   · 닉네임에 onPress 를 아예 안 건다 — 눌러도 아무 반응이 없으면 고장 난 것처럼 보인다
 *   · 혹시 어딘가에서 열려도 이 컴포넌트가 null 을 돌려줘 메뉴가 안 뜬다
 *   · 화면 자체는 주소로 직접 들어가면 여전히 동작한다(들어갈 길이 없을 뿐)
 */
export const AUTHOR_MENU_ENABLED = false

export type AuthorMenuTarget = {
  token: string
  nickname: string
  x: number
  y: number
}

const MENU_W = 168
const MENU_H = 96          // 두 줄 + 위아래 여백 실측
const EDGE = 12            // 화면 가장자리에서 최소 이만큼 띄운다
const GAP = 8              // 누른 지점에서 살짝 아래

export default function AuthorMenu({
  target, onClose,
}: {
  target: AuthorMenuTarget | null
  onClose: () => void
}) {
  const router = useRouter()
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  if (!AUTHOR_MENU_ENABLED) return null
  if (!target) return null

  const { width: sw, height: sh } = Dimensions.get('window')
  const left = Math.min(Math.max(EDGE, target.x - MENU_W / 2), sw - MENU_W - EDGE)
  // 아래로 넘치면 누른 지점 위쪽에 띄운다.
  const below = target.y + GAP
  const top = below + MENU_H > sh - EDGE ? Math.max(EDGE, target.y - MENU_H - GAP) : below

  const go = (tab: 'post' | 'comment') => {
    onClose()
    router.push({
      pathname: '/board/author/[token]',
      params: { token: target.token, nickname: target.nickname, tab },
    })
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* 바깥 아무 데나 누르면 닫힌다 */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* 메뉴 안을 눌렀을 때 배경까지 눌리지 않게 막는다 */}
        <Pressable style={[styles.menu, { left, top }]} onPress={() => {}}>
          <Text style={styles.nick} numberOfLines={1}>{target.nickname}</Text>
          <Pressable
            style={({ pressed }) => [styles.item, pressed && styles.itemOn]}
            onPress={() => go('post')}
          >
            <Ionicons name="document-text-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.itemText}>게시글 보기</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.item, pressed && styles.itemOn]}
            onPress={() => go('comment')}
          >
            <Ionicons name="chatbubble-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.itemText}>댓글 보기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.18)' },
    menu: {
      position: 'absolute',
      width: MENU_W,
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 4,
      // 어두운 배경 위에서도 떠 보이게
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    // 어느 작성자를 고른 건지 확인시켜 준다 — 목록이 촘촘해 옆 사람을 눌렀을 수 있다.
    nick: {
      fontSize: 11.5, fontWeight: '700', color: colors.textTertiary,
      paddingHorizontal: 12, paddingTop: 5, paddingBottom: 6,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
    },
    item: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingVertical: 11,
    },
    itemOn: { backgroundColor: colors.divider },
    itemText: { fontSize: 14, color: colors.textPrimary },
  })
}
