import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, Component, type ReactNode } from 'react'
import { View, TextInput, StyleSheet } from 'react-native'
import type { AppColors } from '@/constants/colors'
import type { RichEditorState } from './BoardRichEditorImpl'

/**
 * 게시판 본문 리치텍스트 에디터(react-native-enriched-html, Software Mansion —
 * 완전 네이티브, 웹뷰 없음). tentap(웹뷰 기반)이 이번 세션에만 세 번 다른 방식으로
 * 실패해서(먹통 화면·이미지 무한로딩·진입 즉시 폭주) 교체했다(오너 지시 2026-08-25).
 *
 * New Architecture(Fabric) 전용 라이브러리라 구형 아키텍처에선 아예 안 뜬다 — 그런
 * 경우까지 포함해 require 실패든 렌더 중 크래시든 평문 입력칸으로 자동 폴백한다.
 */
let Impl: React.ComponentType<any> | null = null
let requireError: string | null = null
try {
  Impl = require('./BoardRichEditorImpl').default
} catch (e: any) {
  Impl = null
  requireError = String(e?.message ?? e)
}
export const RICH_EDITOR_AVAILABLE = Impl !== null

class RichEditorBoundary extends Component<{ onFallback: (reason: string) => void; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch(error: Error) { this.props.onFallback(`render_crash: ${error?.message ?? error}`) }
  render() { return this.state.crashed ? null : this.props.children }
}

export interface RichEditorHandle {
  getHTML: () => Promise<string>
  insertImage: (url: string) => void
  insertLinkText: (url: string) => void
  focus: () => void
  blur: () => void
  toggleBold: () => void
  toggleItalic: () => void
  toggleUnderline: () => void
}

export interface RichEditorProps {
  initialHTML?: string
  placeholder?: string
  onChangeText?: (plainText: string) => void
  onReady?: () => void
  /** 굵게/기울임/밑줄 버튼 활성 표시용 — 하단(키보드 위) 툴바가 이 값으로 토글 상태를 그린다. */
  onStateChange?: (state: RichEditorState) => void
  /** require 실패했거나(모듈 자체 로드 실패) 렌더 중 죽었을 때 한 번 호출된다(원인 문자열 포함) —
   *  상위(write.tsx)가 이걸 받아 자기 화면 전체를 예전 평문 모드로 바꿔야 한다(이 컴포넌트
   *  안에서만 조용히 폴백하면 상위의 첨부 툴바가 안 뜬 채로 남아 "에디터도 안 뜨고 툴바도
   *  없다" 상태가 된다). */
  onUnavailable?: (reason: string) => void
}

/** 폴백(평문) — New Architecture 아니거나 라이브러리 로드 실패 시. getHTML 은 평문을 문단으로 감싼다. */
const Fallback = forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(
  function Fallback({ initialHTML, placeholder, onChangeText, colors }, ref) {
    const valueRef = useRef(stripHtml(initialHTML || ''))
    useImperativeHandle(ref, () => ({
      getHTML: async () => escapeToHtml(valueRef.current),
      insertImage: () => {},
      insertLinkText: () => {},
      focus: () => {},
      blur: () => {},
      toggleBold: () => {},
      toggleItalic: () => {},
      toggleUnderline: () => {},
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
    const [crashed, setCrashed] = useState(false)
    const { onUnavailable } = props
    useEffect(() => {
      if (!Impl) onUnavailable?.(`require_failed: ${requireError}`)
    }, [])
    if (Impl && !crashed) {
      return (
        <RichEditorBoundary onFallback={(reason) => { setCrashed(true); onUnavailable?.(reason) }}>
          <Impl ref={ref} {...props} />
        </RichEditorBoundary>
      )
    }
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
