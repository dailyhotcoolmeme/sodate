import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, Component, type ReactNode } from 'react'
import { View, TextInput, StyleSheet } from 'react-native'
import type { AppColors } from '@/constants/colors'

/**
 * 게시판 본문 리치텍스트 에디터(tentap). 네이버카페급 서식.
 *
 * ⚠️ tentap 은 react-native-webview(네이티브)에 의존한다. 없으면 평문 입력칸으로 폴백.
 *
 * ⚠️(2026-08-24, 두 번째 정정) 원래는 TurboModuleRegistry/UIManager로 "미리" 감지해서
 * 있을 때만 require 했는데, ipa를 직접 열어 바이너리 안 RNCWebView 심볼을 확인해보니
 * 네이티브 코드는 확실히 들어가 있었다 — 그런데도 두 감지 방법 다 계속 false를
 * 돌려줬다(오너 제보: "글쓰기에서 에디터가 전혀 안나온다", 감지 수정 후에도 재현).
 * WebView(RNCWebView)는 Fabric에서 **뷰 컴포넌트**로 등록되고(codegenNativeComponent),
 * TurboModuleRegistry는 **네이티브 모듈**용이라 애초에 확인 대상이 다르다 — 컴파일은
 * 됐어도 이 방법으로는 못 잡을 수 있다는 뜻. 미리 감지하는 대신, 항상 먼저 시도해보고
 * Impl이 마운트 중 실제로 에러를 던지면 그때 평문으로 자동 전환한다(아래 ErrorBoundary).
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
}

export interface RichEditorProps {
  initialHTML?: string
  placeholder?: string
  onChangeText?: (plainText: string) => void
  onReady?: () => void
  onEditorReady?: (editor: unknown) => void   // tentap editor 인스턴스(하단 고정 툴바용)
  /** require 실패했거나(모듈 자체 로드 실패) 렌더 중 죽었을 때 한 번 호출된다(원인 문자열 포함) —
   *  상위(write.tsx)가 이걸 받아 자기 화면 전체를 예전 평문 모드로 바꿔야 한다(이 컴포넌트
   *  안에서만 조용히 폴백하면 상위의 첨부 툴바가 안 뜬 채로 남아 "에디터도 안 뜨고 툴바도
   *  없다" 상태가 된다). */
  onUnavailable?: (reason: string) => void
}

/** 폴백(평문) — webview 없는 현재 바이너리용. getHTML 은 평문을 문단으로 감싼다. */
const Fallback = forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(
  function Fallback({ initialHTML, placeholder, onChangeText, colors }, ref) {
    const valueRef = useRef(stripHtml(initialHTML || ''))
    useImperativeHandle(ref, () => ({
      getHTML: async () => escapeToHtml(valueRef.current),
      insertImage: () => {},
      insertLinkText: () => {},
      focus: () => {},
      blur: () => {},
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
