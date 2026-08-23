import React, { forwardRef, useImperativeHandle, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  RichText, Toolbar, useEditorBridge, useEditorContent,
  CoreBridge, BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
  HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
  CodeBridge, LinkBridge, ColorBridge, HighlightBridge, ImageBridge,
  HistoryBridge, PlaceholderBridge, ListItemBridge,
} from '@10play/tentap-editor'
import type { AppColors } from '@/constants/colors'
import type { RichEditorHandle, RichEditorProps } from './BoardRichEditor'

/**
 * tentap(리치텍스트) 실제 구현. webview 네이티브가 바이너리에 있을 때만 렌더된다
 * (BoardRichEditor 래퍼가 감지 후 require). 풀세트 툴바 — 네이버카페급.
 */
export default forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(function BoardRichEditorImpl(
  { initialHTML, placeholder, onChangeText, onReady, colors },
  ref,
) {
  const editor = useEditorBridge({
    autofocus: false,
    avoidIosKeyboard: true,
    initialContent: initialHTML || '',
    bridgeExtensions: [
      CoreBridge, HistoryBridge, ListItemBridge,
      BoldBridge, ItalicBridge, UnderlineBridge, StrikeBridge,
      HeadingBridge, BulletListBridge, OrderedListBridge, BlockquoteBridge,
      CodeBridge, LinkBridge.configureExtension({ openOnClick: false }),
      ColorBridge, HighlightBridge, ImageBridge,
      PlaceholderBridge.configureExtension({ placeholder: placeholder || '내용을 입력하세요' }),
    ],
  })

  // 저장 시 부모가 HTML 을 뽑아갈 수 있게 + 이미지 삽입 함수 노출
  useImperativeHandle(ref, () => ({
    getHTML: () => editor.getHTML(),
    insertImage: (url: string) => editor.setImage(url),
    focus: () => editor.focus(),
  }), [editor])

  // 본문 텍스트(서식 제외)를 부모에 알려 canSave·글자수 판단에 쓴다
  const text = useEditorContent(editor, { type: 'text' })
  useEffect(() => { onChangeText?.(text || '') }, [text, onChangeText])
  useEffect(() => { onReady?.() }, [onReady])

  const styles = makeStyles(colors)
  return (
    <View style={styles.wrap}>
      <RichText editor={editor} style={styles.rich} />
      <Toolbar editor={editor} />
    </View>
  )
})

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { flex: 1, minHeight: 260 },
    rich: { flex: 1, backgroundColor: colors.background },
  })
}
