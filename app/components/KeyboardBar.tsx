import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Keyboard } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useColors } from '@/hooks/useColors'

/**
 * 키보드 위에 붙는 줄.
 *
 * 왜 필요한가: **아이폰 키보드에는 닫기 키가 없다.** 안드로이드는 시스템 뒤로가기로
 * 닫히지만 iOS는 앱이 직접 이런 줄을 붙여야 한다(카카오톡·네이버 앱도 같다).
 * 그리고 화면 아래에 있는 '등록' 버튼은 키보드가 덮어버려 누를 수가 없다.
 * 그래서 지금 해야 할 행동을 이 줄에 올려 항상 손 닿는 자리에 둔다.
 *
 * 입력이 있는 화면은 전부 이 규칙을 따른다(2026-08-01 오너 확정).
 */
export default function KeyboardBar({
  action,
  onAction,
  disabled = false,
  bottomInset = 0,
}: {
  /** 오른쪽 버튼 글자. 없으면 '완료'(키보드만 닫음) */
  action?: string
  onAction?: () => void
  disabled?: boolean
  /** 키보드가 닫혀 있을 때 아래에 둘 여백(홈 인디케이터 영역) */
  bottomInset?: number
}) {
  const colors = useColors()
  const styles = makeStyles(colors)

  // 항상 화면 아래에 있고, 키보드가 올라오면 그 위로 따라 올라간다.
  const bar = (
    <View style={[styles.bar, { paddingBottom: 10 + bottomInset }]}>
      <TouchableOpacity onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.left}>
        <Text style={styles.dismiss}>키보드 닫기</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => { if (onAction) onAction(); else Keyboard.dismiss() }}
        disabled={disabled}
        hitSlop={8}
      >
        <Text style={[styles.action, disabled && styles.actionOff]}>{action ?? '완료'}</Text>
      </TouchableOpacity>
    </View>
  )

  return <KeyboardStickyView offset={{ closed: 0, opened: bottomInset }}>{bar}</KeyboardStickyView>
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
    },
    left: { paddingVertical: 2 },
    dismiss: { fontSize: 13, color: colors.textSecondary },
    action: { fontSize: 15, fontWeight: '800', color: colors.primary },
    actionOff: { color: colors.textTertiary },
  })
}
