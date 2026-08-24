import React, { forwardRef, useImperativeHandle, useEffect } from 'react'
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
  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: false,   // 키보드 회피는 부모 KeyboardAwareScrollView 가 담당(이중 회피 방지)
    initialContent: initialHTML || '',
    bridgeExtensions: [
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
    ],
  })

  useImperativeHandle(ref, () => ({
    getHTML: () => editor.getHTML(),
    insertImage: (url: string) => editor.setImage(url),
    focus: () => editor.focus(),
  }), [editor])

  // 본문 평문(서식 제외)을 부모에 전달 — canSave·글자수 판단용
  const text = useEditorContent(editor, { type: 'text' })
  useEffect(() => { onChangeText?.(text || '') }, [text, onChangeText])
  // editor 인스턴스를 부모에 넘겨 하단 고정 툴바를 그리게 한다
  useEffect(() => { onEditorReady?.(editor); onReady?.() }, [editor, onEditorReady, onReady])

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
