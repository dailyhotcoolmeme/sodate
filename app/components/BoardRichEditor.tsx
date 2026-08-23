import React, { forwardRef, useImperativeHandle, useRef } from 'react'
import { UIManager, View, TextInput, StyleSheet } from 'react-native'
import type { AppColors } from '@/constants/colors'

/**
 * 게시판 본문 리치텍스트 에디터(tentap). 네이버카페급 서식.
 *
 * ⚠️ tentap 은 react-native-webview(네이티브)에 의존한다. 재빌드 전 바이너리엔
 * webview 가 없어 import 시점에 크래시하므로(네이버 지도와 동일), webview 등록
 * 여부를 감지해 있을 때만 tentap 구현체를 require 한다. 없으면 평문 입력칸으로 폴백.
 * → 현재 앱은 폴백(평문), 재빌드 후 리치에디터 활성. 이후 에디터는 OTA 로 다듬는다.
 */
export const RICH_EDITOR_AVAILABLE = !!UIManager.getViewManagerConfig?.('RNCWebView')

export interface RichEditorHandle {
  getHTML: () => Promise<string>
  insertImage: (url: string) => void
  focus: () => void
}

export interface RichEditorProps {
  initialHTML?: string
  placeholder?: string
  onChangeText?: (plainText: string) => void
  onReady?: () => void
}

let Impl: React.ComponentType<any> | null = null
if (RICH_EDITOR_AVAILABLE) {
  Impl = require('./BoardRichEditorImpl').default
}

/** 폴백(평문) — webview 없는 현재 바이너리용. getHTML 은 평문을 문단으로 감싼다. */
const Fallback = forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(
  function Fallback({ initialHTML, placeholder, onChangeText, colors }, ref) {
    const valueRef = useRef(stripHtml(initialHTML || ''))
    useImperativeHandle(ref, () => ({
      getHTML: async () => escapeToHtml(valueRef.current),
      insertImage: () => {},
      focus: () => {},
    }), [])
    return (
      <View style={{ minHeight: 260 }}>
        <TextInput
          style={fbStyles(colors).input}
          defaultValue={valueRef.current}
          onChangeText={(t) => { valueRef.current = t; onChangeText?.(t) }}
          placeholder={placeholder || '내용을 입력하세요'}
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
        />
      </View>
    )
  }
)

export default forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(
  function BoardRichEditor(props, ref) {
    if (Impl) return <Impl ref={ref} {...props} />
    return <Fallback ref={ref} {...props} />
  }
)

// 평문 → 문단 HTML(폴백 저장용). XSS 방지 위해 이스케이프 후 <p> 로 감쌈.
function escapeToHtml(text: string): string {
  const esc = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}
function stripHtml(html: string): string {
  if (!/[<][a-z/]/i.test(html)) return html
  return html.replace(/<br\s*\/?>(?=)/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

function fbStyles(colors: AppColors) {
  return StyleSheet.create({
    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 22,
      color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, minHeight: 260,
    },
  })
}
