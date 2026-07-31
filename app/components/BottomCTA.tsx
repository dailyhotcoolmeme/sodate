import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useColors } from '@/hooks/useColors'

/**
 * 화면 아래에 고정되는 주 동작 버튼. 키보드가 올라오면 그 위로 따라 올라온다.
 *
 * 한국 앱의 표준 자리다(2026-07-31 조사).
 *   · 토스 디자인 시스템 BottomCTA: "보통 페이지 하단에 항상 고정되어 있어서,
 *     긴 스크롤이나 키보드 입력 시에도 손쉽게 접근할 수 있어요."
 *   · 당근 Seed Design 폼 화면 설계: 앱바(뒤로가기+제목) → 내용 → BottomCTA(등록 버튼).
 *     앱바에는 주 동작을 두지 않는다.
 *   · 엄지 도달 범위 실측(Steven Hoober, 1,333명): 화면 위쪽 모서리가 가장 안 닿는다.
 *     주 동작은 아래쪽에 둔다.
 *
 * 이 자리에 '글자'만 얹지 않는다 — 채워진 버튼이어야 누를 것으로 보인다.
 */
export default function BottomCTA({
  label,
  onPress,
  disabled = false,
  bottomInset = 0,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  /** 키보드가 닫혀 있을 때 아래에 둘 여백(홈 인디케이터 영역) */
  bottomInset?: number
}) {
  const colors = useColors()
  const styles = makeStyles(colors)

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: bottomInset }}>
      <View style={[styles.bar, { paddingBottom: 10 + bottomInset }]}>
        <TouchableOpacity
          style={[styles.btn, disabled && styles.btnOff]}
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.85}
        >
          <Text style={[styles.text, disabled && styles.textOff]}>{label}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardStickyView>
  )
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    bar: {
      paddingHorizontal: 16, paddingTop: 10,
      backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    btn: {
      backgroundColor: colors.primary, borderRadius: 12,
      paddingVertical: 14, alignItems: 'center',
    },
    btnOff: { backgroundColor: colors.border },
    text: { color: '#fff', fontSize: 15, fontWeight: '800' },
    textOff: { color: colors.textTertiary },
  })
}
