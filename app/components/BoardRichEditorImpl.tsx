import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
  type OnChangeStateEvent,
  type OnChangeSelectionEvent,
} from 'react-native-enriched-html'
import type { AppColors } from '@/constants/colors'
import type { RichEditorHandle, RichEditorProps } from './BoardRichEditor'

/**
 * react-native-enriched-html(Software Mansion, 완전 네이티브 — 웹뷰 없음) 실제 구현.
 * tentap(웹뷰 기반)이 이번 세션에만 세 번(먹통 화면·이미지 무한로딩·진입 즉시 폭주)
 * 다르게 실패해서 교체했다(오너 지시 2026-08-25: "새로운 에디터를 찾아봐라"). 글자색·
 * 배경색 토글은 이 라이브러리에 아직 없어서 뺐다(오너에게 사전 보고·승인 완료).
 */
export type RichEditorState = OnChangeStateEvent | null

export default forwardRef<RichEditorHandle, RichEditorProps & { colors: AppColors }>(
  function BoardRichEditorImpl(
    { initialHTML, placeholder, onChangeText, onReady, onStateChange, colors },
    ref,
  ) {
    const inputRef = useRef<EnrichedTextInputInstance>(null)
    // 링크 삽입(setLink)은 어느 범위에 걸지 알아야 하는데, 그 값을 상위(write.tsx)
    // 로 async 없이 즉시 넘겨줘야 해서(모달 여는 순간 필요) 매번 최신값을 ref 에만
    // 담아두고 getSelection() 으로 동기 조회한다.
    const selectionRef = useRef({ start: 0, end: 0, text: '' })

    useImperativeHandle(ref, () => ({
      getHTML: () => inputRef.current?.getHTML() ?? Promise.resolve(''),
      insertImage: () => {},
      insertLinkText: () => {},
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      toggleBold: () => inputRef.current?.toggleBold(),
      toggleItalic: () => inputRef.current?.toggleItalic(),
      toggleUnderline: () => inputRef.current?.toggleUnderline(),
      toggleStrikeThrough: () => inputRef.current?.toggleStrikeThrough(),
      toggleBlockQuote: () => inputRef.current?.toggleBlockQuote(),
      toggleOrderedList: () => inputRef.current?.toggleOrderedList(),
      toggleUnorderedList: () => inputRef.current?.toggleUnorderedList(),
      toggleCheckboxList: () => inputRef.current?.toggleCheckboxList(false),
      setLink: (start, end, text, url) => inputRef.current?.setLink(start, end, text, url),
      removeLink: (start, end) => inputRef.current?.removeLink(start, end),
      getSelection: () => selectionRef.current,
    }), [])

    // 네이티브 컴포넌트라 tentap 웹뷰처럼 비동기 로드를 기다릴 필요가 없다 — 마운트되면
    // 바로 쓸 수 있으니 한 번만 알린다(상위가 이걸로 하단 고정 툴바를 그림).
    useEffect(() => { onReady?.() }, [])

    const styles = makeStyles(colors)
    return (
      <View style={styles.wrap}>
        <EnrichedTextInput
          ref={inputRef}
          defaultValue={initialHTML || ''}
          placeholder={placeholder || '내용을 입력하세요'}
          placeholderTextColor={colors.textTertiary}
          cursorColor={colors.primary}
          selectionColor={`${colors.primary}55`}
          // 내부 스크롤 없이 박스 자체가 내용만큼 늘어난다 — 라이브러리 정식 기능(오너
          // 지시 "입력박스는 무조건 높이 늘어나는 방식으로"). tentap dynamicHeight 처럼
          // 웹뷰 높이 보고를 흉내내는 방식이 아니라 네이티브 텍스트 레이아웃이라 안정적.
          scrollEnabled={false}
          style={styles.input}
          htmlStyle={{
            a: { color: colors.primary },
            blockquote: { color: colors.textSecondary, borderColor: colors.border },
          }}
          onChangeText={(e) => onChangeText?.(e.nativeEvent.value)}
          onChangeState={(e) => onStateChange?.(e.nativeEvent)}
          onChangeSelection={(e: { nativeEvent: OnChangeSelectionEvent }) => { selectionRef.current = e.nativeEvent }}
        />
      </View>
    )
  },
)

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { width: '100%' },
    input: {
      minHeight: 200,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
    },
  })
}
