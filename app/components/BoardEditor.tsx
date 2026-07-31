import React, { useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert,
  type NativeSyntheticEvent, type TextInputSelectionChangeEventData,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
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

type Mark = { label: string; icon: keyof typeof Ionicons.glyphMap; wrap: [string, string] }

const MARKS: Mark[] = [
  { label: '굵게', icon: 'text', wrap: ['**', '**'] },
  { label: '기울임', icon: 'text-outline', wrap: ['_', '_'] },
  { label: '취소선', icon: 'remove-outline', wrap: ['~~', '~~'] },
  { label: '인용', icon: 'chatbox-outline', wrap: ['\n> ', ''] },
  { label: '목록', icon: 'list-outline', wrap: ['\n- ', ''] },
  { label: '링크', icon: 'link-outline', wrap: ['[', '](https://)'] },
]

export default function BoardEditor({
  value, onChangeText, images, onChangeImages, maxLength, placeholder,
}: {
  value: string
  onChangeText: (t: string) => void
  images: string[]
  onChangeImages: (next: string[]) => void
  maxLength?: number
  placeholder?: string
}) {
  const colors = useColors()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const inputRef = useRef<TextInput>(null)
  const [sel, setSel] = useState({ start: 0, end: 0 })
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(false)

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) =>
    setSel(e.nativeEvent.selection)

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

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
          {MARKS.map((m) => (
            <TouchableOpacity key={m.label} style={styles.tool} onPress={() => applyMark(m)}>
              <Text style={styles.toolText}>{m.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.tool} onPress={addImage} disabled={uploading}>
            <Ionicons name="image-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.toolText}>{uploading ? '올리는 중' : '사진'}</Text>
          </TouchableOpacity>
        </ScrollView>
        <TouchableOpacity style={styles.previewBtn} onPress={() => setPreview((v) => !v)}>
          <Text style={[styles.toolText, preview && styles.previewOn]}>
            {preview ? '편집' : '미리보기'}
          </Text>
        </TouchableOpacity>
      </View>

      {preview ? (
        <View style={styles.previewBox}>
          <MarkdownText text={value} styles={styles} />
        </View>
      ) : (
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
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
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tools: { gap: 6, paddingRight: 6 },
    tool: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    toolText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    previewBtn: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    previewOn: { color: colors.primary },

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
