import React, { useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert,
  type NativeSyntheticEvent, type TextInputSelectionChangeEventData,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons, MaterialIcons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { pickAndUpload, MAX_IMAGES } from '@/lib/boardImage'

/**
 * 게시판 본문 편집기 — 서식 도구 + 사진 첨부.
 *
 * 웹 게시판처럼 화면에 바로 굵게 보이는 편집기는 RN에서 만들기 어렵고 버그가 잦다.
 * 대신 표시용 기호를 넣어주는 도구 모음을 두고, 읽을 때 서식으로 그려준다(마크다운).
 * 사용자는 버튼만 누르면 되고, 무엇이 적용됐는지 미리보기로 확인할 수 있다.
 */

// 도구는 어느 편집기에서나 쓰는 아이콘 그대로 둔다(굵게 B, 기울임 I, 취소선 S…).
// 글자 라벨을 테두리 상자에 넣으면 게시판 편집기처럼 안 보인다(2026-08-01 오너 지적).
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

export default function BoardEditor({
  value, onChangeText, images, onChangeImages, maxLength, placeholder,
  inputRef, onFocus, onBlur, onCaretMove,
}: {
  value: string
  onChangeText: (t: string) => void
  images: string[]
  onChangeImages: (next: string[]) => void
  maxLength?: number
  placeholder?: string
  /** 바깥에서 입력칸 위치를 재야 커서를 키보드 위로 끌어올릴 수 있다. */
  inputRef?: React.RefObject<TextInput | null>
  onFocus?: () => void
  onBlur?: () => void
  /** 줄이 늘거나 커서가 움직일 때 — 화면을 커서에 맞춰 스크롤하라는 신호. */
  onCaretMove?: () => void
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const localRef = useRef<TextInput>(null)
  const ref = inputRef ?? localRef
  const [sel, setSel] = useState({ start: 0, end: 0 })
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    setSel(e.nativeEvent.selection)
    onCaretMove?.()
  }

  /** 고른 글자를 기호로 감싼다. 고른 게 없으면 커서 자리에 넣고 가운데로 커서를 둔다. */
  const applyMark = (m: Mark) => {
    const [open, close] = m.wrap
    const start = Math.min(sel.start, sel.end)
    const end = Math.max(sel.start, sel.end)
    const picked = value.slice(start, end)
    const next = value.slice(0, start) + open + picked + close + value.slice(end)
    onChangeText(next)
    const caret = start + open.length + picked.length
    requestAnimationFrame(() => {
      ref.current?.setNativeProps({ selection: { start: caret, end: caret } })
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

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        {MARKS.map((m) => (
          <TouchableOpacity
            key={m.label}
            style={styles.tool}
            onPress={() => applyMark(m)}
            accessibilityLabel={m.label}
            hitSlop={6}
          >
            <MaterialIcons name={m.icon} size={21} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}

        <View style={styles.toolDivider} />

        <TouchableOpacity
          style={styles.tool}
          onPress={addImage}
          disabled={uploading}
          accessibilityLabel="사진 첨부"
          hitSlop={6}
        >
          <Ionicons
            name={uploading ? 'hourglass-outline' : 'image-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tool, styles.toolLast]}
          onPress={() => setPreview((v) => !v)}
          accessibilityLabel={preview ? '편집으로 돌아가기' : '미리보기'}
          hitSlop={6}
        >
          <Ionicons
            name={preview ? 'create-outline' : 'eye-outline'}
            size={20}
            color={preview ? colors.primary : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      {preview ? (
        <View style={styles.previewBox}>
          <MarkdownText text={value} styles={styles} />
        </View>
      ) : (
        <TextInput
          ref={ref}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
          onContentSizeChange={() => onCaretMove?.()}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          maxLength={maxLength}
          multiline
          textAlignVertical="top"
        />
      )}

      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {images.map((u) => (
            <View key={u} style={styles.thumbWrap}>
              <Image source={{ uri: u }} style={styles.thumb} contentFit="cover" />
              <TouchableOpacity
                style={styles.thumbX}
                onPress={() => onChangeImages(images.filter((x) => x !== u))}
                hitSlop={6}
              >
                <Ionicons name="close" size={13} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

/**
 * 아주 작은 마크다운 표시기.
 * 게시판에서 쓰는 것만 그린다 — 굵게·기울임·취소선·인용·목록·링크.
 * 외부 라이브러리를 쓰면 스타일이 앱과 겉돌아 직접 그린다.
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

/** **굵게** _기울임_ ~~취소선~~ [글자](주소) 를 조각으로 나눠 그린다. */
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
    else {
      const label = t.slice(1, t.indexOf(']'))
      out.push(<Text key={key++} style={styles.link}>{label}</Text>)
    }
    last = m.index + t.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

export function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    // 테두리 상자 없이 아이콘만 늘어놓는다. 시중 게시판 편집기가 다 이 모양이다.
    toolbar: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
    tool: { paddingHorizontal: 7, paddingVertical: 4 },
    toolLast: { marginLeft: 'auto', paddingRight: 0 },
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
    quote: {
      borderLeftWidth: 3, borderLeftColor: colors.border,
      paddingLeft: 10, marginVertical: 3,
    },
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
