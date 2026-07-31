import React, { useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert,
  type NativeSyntheticEvent, type TextInputSelectionChangeEventData,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { pickAndUpload, MAX_IMAGES } from '@/lib/boardImage'
import LoadingOverlay from '@/components/LoadingOverlay'

/**
 * 게시판 본문 편집기.
 *
 * 화면 배치는 애플 가이드라인을 따른다(2026-08-01 조사).
 *   · 주 동작(등록)은 **상단 내비게이션 바**에 둔다. 키보드 위에 '등록' 글자를 얹는
 *     형태는 어느 앱에도 없다.
 *   · **키보드 위 액세서리는 서식 도구 자리다.** 가이드라인이 메일 앱의 서식 도구를
 *     그 예로 든다. 오른쪽 끝에 키보드 내리는 버튼을 둔다(아이폰엔 닫기 키가 없다).
 *
 * 그래서 입력칸과 도구 모음을 따로 내보낸다. 화면이 입력칸은 스크롤 안에,
 * 도구 모음은 스크롤 밖(키보드 위)에 둔다.
 */

type Mark = {
  label: string
  icon: keyof typeof MaterialIcons.glyphMap
  wrap: [string, string]
}

const MARKS: Mark[] = [
  { label: '굵게', icon: 'format-bold', wrap: ['**', '**'] },
  { label: '기울임', icon: 'format-italic', wrap: ['_', '_'] },
  { label: '취소선', icon: 'format-strikethrough', wrap: ['~~', '~~'] },
  { label: '인용', icon: 'format-quote', wrap: ['\n> ', ''] },
  { label: '목록', icon: 'format-list-bulleted', wrap: ['\n- ', ''] },
  { label: '링크', icon: 'link', wrap: ['[', '](https://)'] },
]

export function useBoardEditor(
  value: string,
  onChangeText: (t: string) => void,
  images: string[],
  onChangeImages: (next: string[]) => void
) {
  const inputRef = useRef<TextInput>(null)
  const [sel, setSel] = useState({ start: 0, end: 0 })
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
    setSel(e.nativeEvent.selection)

  /** 고른 글자를 기호로 감싼다. 고른 게 없으면 커서 자리에 넣는다. */
  const applyMark = (m: Mark) => {
    const [open, close] = m.wrap
    const start = Math.min(sel.start, sel.end)
    const end = Math.max(sel.start, sel.end)
    const picked = value.slice(start, end)
    onChangeText(value.slice(0, start) + open + picked + close + value.slice(end))
    const caret = start + open.length + picked.length
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection: { start: caret, end: caret } })
    })
  }

  const addImage = async () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert('알림', `사진은 ${MAX_IMAGES}장까지 올릴 수 있어요.`)
      return
    }
    setUploading(true)
    const r = await pickAndUpload()
    setUploading(false)
    if (!r) return
    if ('error' in r) { Alert.alert('알림', r.error); return }
    onChangeImages([...images, r.url])
  }

  return {
    inputRef, onSelectionChange, applyMark, addImage,
    uploading, preview, setPreview,
    removeImage: (u: string) => onChangeImages(images.filter((x) => x !== u)),
  }
}

export type BoardEditorApi = ReturnType<typeof useBoardEditor>

/** 본문 입력칸 + 첨부한 사진. 스크롤 안에 둔다. */
export function BoardEditorInput({
  api, value, onChangeText, images, maxLength, placeholder,
}: {
  api: BoardEditorApi
  value: string
  onChangeText: (t: string) => void
  images: string[]
  maxLength?: number
  placeholder?: string
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.wrap}>
      {api.preview ? (
        <View style={styles.previewBox}>
          <MarkdownText text={value} styles={styles} />
        </View>
      ) : (
        <TextInput
          ref={api.inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={api.onSelectionChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          maxLength={maxLength}
          multiline
          textAlignVertical="top"
        />
      )}

      <LoadingOverlay visible={api.uploading} />

      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {images.map((u) => (
            <View key={u} style={styles.thumbWrap}>
              <Image source={{ uri: u }} style={styles.thumb} contentFit="cover" />
              <TouchableOpacity style={styles.thumbX} onPress={() => api.removeImage(u)} hitSlop={6}>
                <Ionicons name="close" size={13} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

/** 서식 도구 — 키보드 위에 붙는다. 화면 맨 아래(스크롤 밖)에 둘 것. */
export function BoardEditorToolbar({
  api, bottomInset = 0,
}: {
  api: BoardEditorApi
  bottomInset?: number
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: bottomInset }}>
      <View style={[styles.toolbar, { paddingBottom: 6 + bottomInset }]}>
        {MARKS.map((m) => (
          <TouchableOpacity
            key={m.label}
            style={styles.tool}
            onPress={() => api.applyMark(m)}
            accessibilityLabel={m.label}
            hitSlop={6}
          >
            <MaterialIcons name={m.icon} size={21} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}

        <View style={styles.toolDivider} />

        <TouchableOpacity
          style={styles.tool}
          onPress={api.addImage}
          disabled={api.uploading}
          accessibilityLabel="사진 첨부"
          hitSlop={6}
        >
          <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tool}
          onPress={() => api.setPreview((v) => !v)}
          accessibilityLabel={api.preview ? '편집으로 돌아가기' : '미리보기'}
          hitSlop={6}
        >
          <Ionicons
            name={api.preview ? 'create-outline' : 'eye-outline'}
            size={20}
            color={api.preview ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>

        {/* 아이폰 키보드에는 닫기 키가 없다. 오른쪽 끝에 내리는 버튼을 둔다. */}
        <TouchableOpacity
          style={[styles.tool, styles.toolLast]}
          onPress={() => api.inputRef.current?.blur()}
          accessibilityLabel="키보드 내리기"
          hitSlop={6}
        >
          <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </KeyboardStickyView>
  )
}

/**
 * 아주 작은 마크다운 표시기 — 굵게·기울임·취소선·인용·목록·링크만.
 * 외부 라이브러리는 스타일이 앱과 겉돌아 직접 그린다.
 */
export function MarkdownText({
  text, styles,
}: {
  text: string
  styles: ReturnType<typeof makeStyles>
}) {
  const lines = (text || '').split('\n')
  return (
    <View>
      {lines.map((line, i) => {
        if (line.startsWith('> ')) {
          return (
            <View key={i} style={styles.quote}>
              <Text style={styles.body}>{renderInline(line.slice(2), styles)}</Text>
            </View>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <View key={i} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={[styles.body, { flex: 1 }]}>{renderInline(line.slice(2), styles)}</Text>
            </View>
          )
        }
        return <Text key={i} style={styles.body}>{renderInline(line, styles)}</Text>
      })}
    </View>
  )
}

function renderInline(line: string, styles: ReturnType<typeof makeStyles>): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) out.push(<Text key={key++} style={styles.bold}>{t.slice(2, -2)}</Text>)
    else if (t.startsWith('~~')) out.push(<Text key={key++} style={styles.strike}>{t.slice(2, -2)}</Text>)
    else if (t.startsWith('_')) out.push(<Text key={key++} style={styles.italic}>{t.slice(1, -1)}</Text>)
    else out.push(<Text key={key++} style={styles.link}>{t.slice(1, t.indexOf(']'))}</Text>)
    last = m.index + t.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

export function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { gap: 8 },

    // 서식 도구 — 테두리 상자 없이 아이콘만. 키보드 위에 붙는다.
    toolbar: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 10, paddingTop: 6,
      backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    tool: { paddingHorizontal: 7, paddingVertical: 6 },
    toolLast: { marginLeft: 'auto', paddingRight: 2 },
    toolDivider: { width: 1, height: 15, marginHorizontal: 6, backgroundColor: colors.border },

    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border, minHeight: 220,
    },
    previewBox: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      borderWidth: 1, borderColor: colors.border, minHeight: 220,
    },

    body: { fontSize: 15, lineHeight: 23, color: colors.textPrimary },
    bold: { fontWeight: '800' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through', color: colors.textSecondary },
    link: { color: colors.primary, textDecorationLine: 'underline' },
    quote: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10, marginVertical: 3 },
    bullet: { flexDirection: 'row', gap: 7, marginVertical: 1 },
    bulletDot: { fontSize: 15, lineHeight: 23, color: colors.textSecondary },

    thumbs: { gap: 8, paddingVertical: 2 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: colors.surfaceHigh },
    thumbX: {
      position: 'absolute', top: -5, right: -5,
      width: 21, height: 21, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center', justifyContent: 'center',
    },
  })
}
