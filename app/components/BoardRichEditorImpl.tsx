import React, { forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  RichText, useEditorBridge, useEditorContent,
  CoreBridge, BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
  HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
  CodeBridge, LinkBridge, ColorBridge, HighlightBridge, ImageBridge,
  HistoryBridge, PlaceholderBridge, ListItemBridge,
} from '@10play/tentap-editor'
import type { AppColors } from '@/constants/colors'
import type { RichEditorHandle, RichEditorProps } from './BoardRichEditor'

/**
 * tentap(리치텍스트) 실제 구현. webview 네이티브가 바이너리에 있을 때만 렌더된다.
 * 툴바는 여기서 그리지 않는다 — 키보드 위에 고정해야 해서(KeyboardStickyView) 부모가
 * onEditorReady 로 받은 editor 로 BoardRichToolbar 를 화면 하단에 따로 그린다.
 */
export default forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(function BoardRichEditorImpl(
  { initialHTML, placeholder, onChangeText, onReady, onEditorReady, colors },
  ref,
) {
  // ⚠️(2026-08-25) bridgeExtensions 배열을 렌더마다 새로 만들면(인라인 배열 리터럴)
  // useEditorBridge 가 매번 "설정이 바뀌었다"고 보고 내부적으로 다시 초기화 → 그게 다시
  // 리렌더를 유발 → 또 새 배열... 이 무한 루프에 빠졌다("Maximum update depth exceeded",
  // 실기기에서 터치가 완전히 먹통되던 원인 — 시뮬레이터로 직접 재현해서 실제 에러 로그로
  // 확인함). useMemo 로 배열 참조를 고정해서 이 루프를 끊는다.
  const bridgeExtensions = useMemo(() => [
    // 본문 내부 패딩을 제목 입력칸(paddingHorizontal 14 · paddingVertical 12)과 맞춘다.
    CoreBridge.configureCSS(`
      .ProseMirror { padding: 12px 14px; font-size: 15px; line-height: 1.5; }
      .ProseMirror p { margin: 0 0 8px; }
      .ProseMirror img { max-width: 100%; height: auto; border-radius: 8px; }
    `),
    HistoryBridge, ListItemBridge,
    BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
    HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
    CodeBridge, LinkBridge.configureExtension({ openOnClick: false }),
    ColorBridge, HighlightBridge, ImageBridge,
    PlaceholderBridge.configureExtension({ placeholder: placeholder || '내용을 입력하세요' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [placeholder])

  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: false,   // 키보드 회피는 부모 KeyboardAwareScrollView 가 담당(이중 회피 방지)
    initialContent: initialHTML || '',
    bridgeExtensions,
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor.getHTML(),
    insertImage: (url: string) => editor.setImage(url),
    focus: () => editor.focus(),
  }), [editor])

  // 본문 평문(서식 제외)을 부모에 전달 — canSave·글자수 판단용
  const text = useEditorContent(editor, { type: 'text' })
  useEffect(() => { onChangeText?.(text || '') }, [text, onChangeText])
  // editor 인스턴스를 부모에 넘겨 하단 고정 툴바를 그리게 한다.
  // ⚠️(2026-08-25, 진짜 원인) useEditorBridge 가 돌려주는 editor 객체가 렌더마다 새
  // 참조라, 이 effect(의존성 [editor,...])가 매번 다시 돌면서 부모의 setRichEditor(state
  // setter)를 계속 호출 → 부모 리렌더 → 자식 리렌더 → editor 다시 "새 참조" → 또 effect...
  // 로 무한 루프에 빠졌다("Maximum update depth exceeded" — 실기기에서 터치가 완전히
  // 먹통되던 진짜 원인, 시뮬레이터로 재현해서 실제 에러 로그로 확인함). 부모에게는 딱
  // 한 번만 알리면 충분하니(그 이후 editor 참조가 바뀌어도 내부적으로 같은 브릿지를
  // 계속 쓰므로 다시 알릴 필요 없음) ref 로 한 번만 실행되게 막는다.
  const reportedReadyRef = useRef(false)
  useEffect(() => {
    if (reportedReadyRef.current) return
    reportedReadyRef.current = true
    onEditorReady?.(editor)
    onReady?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  const styles = makeStyles(colors)
  return (
    <View style={styles.wrap}>
      <RichText editor={editor} style={styles.rich} />
    </View>
  )
})

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { flex: 1 },
    rich: { flex: 1, backgroundColor: colors.background },
  })
}
