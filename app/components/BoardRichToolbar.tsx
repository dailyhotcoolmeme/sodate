import React, { useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import { useColorScheme } from 'react-native'
import type { AppColors } from '@/constants/colors'

/**
 * 리치에디터 툴바 — 키보드 바로 위에 고정(오너 지시 2026-08-25: "키보드 위 방식으로
 * 하자"). react-native-enriched-html 은 완전 네이티브라(웹뷰 없음) 예전 tentap 웹뷰
 * 때 이 위치를 포기했던 이유(웹뷰 스크롤/포커스 충돌)가 애초에 없다.
 *
 * 배경은 반투명(BlurView) — "키보드 위에 모두 같은 배경색 투명느낌나게"(오너 지시).
 * 버튼이 늘어나도(향후 서식 추가 등) 안 잘리게 가로 스와이프 가능(오너 지시: "에디터들
 * 스와이프로 움직이게").
 *
 * ⚠️ undo(되돌리기) 버튼은 뺐다 — 이 라이브러리 ref API 에 undo/redo 커맨드가 없다
 * (tentap 은 있었음). 기기 자체 되돌리기(iOS 흔들기, 안드 시스템 입력기)에 맡긴다.
 */
export interface ToolbarButton {
  key: string
  icon: 'photo' | 'youtube' | 'bold' | 'italic' | 'underline'
  active?: boolean
  disabled?: boolean
  onPress: () => void
}

export default function BoardRichToolbar({ buttons, colors }: { buttons: ToolbarButton[]; colors: AppColors }) {
  const scheme = useColorScheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <BlurView
      intensity={80}
      tint={scheme === 'dark' ? 'dark' : 'light'}
      style={styles.wrap}
    >
      <View style={styles.tint} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="always">
        {buttons.map((b) => (
          <TouchableOpacity
            key={b.key}
            style={[styles.btn, b.active && styles.btnActive]}
            onPress={b.onPress}
            disabled={b.disabled}
            hitSlop={6}
            activeOpacity={0.7}
          >
            <ToolbarIcon icon={b.icon} colors={colors} disabled={!!b.disabled} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </BlurView>
  )
}

function ToolbarIcon({ icon, colors, disabled }: { icon: ToolbarButton['icon']; colors: AppColors; disabled: boolean }) {
  const tint = disabled ? colors.textTertiary : colors.textSecondary
  if (icon === 'photo') return <Image source={require('@/assets/rich-toolbar/photo.png')} style={[styles.img, { tintColor: tint }]} />
  if (icon === 'youtube') return <Image source={require('@/assets/rich-toolbar/youtube.png')} style={[styles.img, { tintColor: tint }]} />
  const glyph = icon === 'bold' ? 'B' : icon === 'italic' ? 'I' : 'U'
  return (
    <Text style={[
      styles.glyph,
      { color: tint },
      icon === 'bold' && styles.glyphBold,
      icon === 'italic' && styles.glyphItalic,
      icon === 'underline' && styles.glyphUnderline,
    ]}>
      {glyph}
    </Text>
  )
}

const styles = StyleSheet.create({
  img: { width: 21, height: 21, resizeMode: 'contain' },
  glyph: { fontSize: 17, fontWeight: '700', width: 21, textAlign: 'center' },
  glyphBold: { fontWeight: '800' },
  glyphItalic: { fontStyle: 'italic' },
  glyphUnderline: { textDecorationLine: 'underline' },
})

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { height: 48, overflow: 'hidden' },
    // BlurView 만으로는 브랜드 톤이 안 실려서 아주 옅게 앱 표면색을 겹친다 — 완전
    // 불투명이 아니라 "투명한데 톤은 앱스러운" 느낌(오너 지시 그대로).
    tint: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surfaceHigh, opacity: 0.35 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 48 },
    btn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    btnActive: { backgroundColor: colors.divider },
  })
}
