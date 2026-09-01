import React, { useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { AppColors } from '@/constants/colors'

/**
 * 리치에디터 툴바 — 키보드 바로 위에 고정(오너 지시 2026-08-25: "키보드 위 방식으로
 * 하자"). react-native-enriched-html 은 완전 네이티브라(웹뷰 없음) 예전 tentap 웹뷰
 * 때 이 위치를 포기했던 이유(웹뷰 스크롤/포커스 충돌)가 애초에 없다.
 *
 * ⚠️(2026-08-26) 안드 실기기에서 이 툴바 전체가 안 보이는 사고가 났다 — 원인 후보를
 *하나씩 지우는 A/B 테스트 중 첫 번째로, 배경에 쓰던 expo-blur BlurView 를 뺐다.
 * 외부 AI 3곳(챗지피티·제미나이·그록) 교차 검증 — "BlurTargetView 없이 BlurView만
 * 쓰면 블러 효과만 꺼지고 반투명으로 대체되는 게 공식 동작이지, 자식(버튼)까지
 * 안 보여야 한다는 근거는 없다"는 데 셋 다 동의했지만, 그래도 변수를 하나 줄이려고
 * 가장 먼저 제거한다. 이걸로도 안 고쳐지면 다음 용의자는 KeyboardStickyView 자체.
 * "투명느낌"은 반투명 배경색(rgba)만으로 유지 — 블러(뒤 배경이 흐려 보이는 효과)는
 * 없지만 기능상 차이는 없다.
 *
 * 버튼이 늘어나도(향후 서식 추가 등) 안 잘리게 가로 스와이프 가능(오너 지시: "에디터들
 * 스와이프로 움직이게").
 *
 * ⚠️ undo(되돌리기) 버튼은 뺐다 — 이 라이브러리 ref API 에 undo/redo 커맨드가 없다
 * (tentap 은 있었음). 기기 자체 되돌리기(iOS 흔들기, 안드 시스템 입력기)에 맡긴다.
 */
export interface ToolbarButton {
  key: string
  icon: 'photo' | 'youtube' | 'bold' | 'italic' | 'underline' | 'strike' | 'quote' | 'orderedList' | 'unorderedList' | 'checkbox' | 'link'
  active?: boolean
  disabled?: boolean
  onPress: () => void
}

export default function BoardRichToolbar({ buttons, colors }: { buttons: ToolbarButton[]; colors: AppColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.wrap}>
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
    </View>
  )
}

// 굵게·기울임·밑줄과 같은 이유(라이브러리가 툴바 UI를 안 줌)로, 취소선·인용구·
// 순서·비순서 목록도 별도 아이콘 에셋 없이 글자 글리프로 표현한다(오너 승인
// 2026-08-26: 취소선/인용구/순서목록/비순서목록/체크박스목록/링크 추가). 링크·
// 체크박스는 Ionicons(이미 프로젝트 의존성)에 딱 맞는 아이콘이 있어 그걸 쓴다.
function ToolbarIcon({ icon, colors, disabled }: { icon: ToolbarButton['icon']; colors: AppColors; disabled: boolean }) {
  const tint = disabled ? colors.textTertiary : colors.textSecondary
  if (icon === 'photo') return <Image source={require('@/assets/rich-toolbar/photo.png')} style={[styles.img, { tintColor: tint }]} />
  if (icon === 'youtube') return <Image source={require('@/assets/rich-toolbar/youtube.png')} style={[styles.img, { tintColor: tint }]} />
  if (icon === 'link') return <Ionicons name="link-outline" size={20} color={tint} />
  if (icon === 'checkbox') return <Ionicons name="checkbox-outline" size={19} color={tint} />
  const glyphMap: Partial<Record<ToolbarButton['icon'], string>> = {
    bold: 'B', italic: 'I', underline: 'U', strike: 'S', quote: '“', orderedList: '1.', unorderedList: '•',
  }
  return (
    <Text style={[
      styles.glyph,
      { color: tint },
      icon === 'bold' && styles.glyphBold,
      icon === 'italic' && styles.glyphItalic,
      icon === 'underline' && styles.glyphUnderline,
      icon === 'strike' && styles.glyphStrike,
      icon === 'quote' && styles.glyphQuote,
      icon === 'orderedList' && styles.glyphOrderedList,
      icon === 'unorderedList' && styles.glyphUnorderedList,
    ]}>
      {glyphMap[icon]}
    </Text>
  )
}

const styles = StyleSheet.create({
  img: { width: 21, height: 21, resizeMode: 'contain' },
  glyph: { fontSize: 17, fontWeight: '700', width: 21, textAlign: 'center' },
  glyphBold: { fontWeight: '800' },
  glyphItalic: { fontStyle: 'italic' },
  glyphUnderline: { textDecorationLine: 'underline' },
  glyphStrike: { textDecorationLine: 'line-through' },
  glyphQuote: { fontSize: 20, fontWeight: '800' },
  glyphOrderedList: { fontSize: 14, fontWeight: '800' },
  glyphUnorderedList: { fontSize: 22, fontWeight: '900' },
})

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    // 8자리 hex 로 알파를 직접 줘서 반투명(90%) — BlurView 없이도 "투명느낌"은 그대로,
    // 대신 안드에서 BlurTargetView 미설정 때문에 자식이 안 보이는 경로 자체가 없다.
    wrap: { height: 48, overflow: 'hidden', backgroundColor: `${colors.surfaceHigh}E6` },
    row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 48 },
    btn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    btnActive: { backgroundColor: colors.divider },
  })
}
