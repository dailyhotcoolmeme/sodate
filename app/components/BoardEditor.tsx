import React, { useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { pickAndUpload, MAX_IMAGES } from '@/lib/boardImage'
import LoadingOverlay from '@/components/LoadingOverlay'

/**
 * 게시판 본문 입력칸 + 사진 첨부.
 *
 * 서식(굵게·기울임 등)은 넣지 않는다(2026-07-31 오너 확정). 리액트 네이티브 입력칸은
 * 글자마다 다른 서식을 줄 수 없어서, 서식을 흉내내면 본문에 `**` 같은 기호가 그대로
 * 박힌다. 진짜로 하려면 웹뷰 에디터를 얹어야 하는데(Expo 공식 문서 Edit rich text)
 * 동네 커뮤니티 게시판에 그만한 무게를 들일 이유가 없다 — 당근 동네생활도 글자와
 * 사진만 받는다.
 */
export function useBoardEditor(images: string[], onChangeImages: (next: string[]) => void) {
  const inputRef = useRef<TextInput>(null)
  const [uploading, setUploading] = useState(false)

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
    inputRef,
    addImage,
    uploading,
    removeImage: (u: string) => onChangeImages(images.filter((x) => x !== u)),
  }
}

export type BoardEditorApi = ReturnType<typeof useBoardEditor>

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
  const full = images.length >= MAX_IMAGES

  return (
    <View style={styles.wrap}>
      <TextInput
        ref={api.inputRef}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        maxLength={maxLength}
        multiline
        textAlignVertical="top"
      />

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

      <TouchableOpacity
        style={[styles.addBtn, full && styles.addBtnOff]}
        onPress={api.addImage}
        disabled={full || api.uploading}
      >
        <Ionicons name="image-outline" size={17} color={full ? colors.textTertiary : colors.textSecondary} />
        <Text style={[styles.addText, full && styles.addTextOff]}>
          사진 첨부 {images.length}/{MAX_IMAGES}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: { gap: 8 },

    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 22,
      color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border, minHeight: 220,
    },

    thumbs: { gap: 8, paddingVertical: 2 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: colors.surfaceHigh },
    thumbX: {
      position: 'absolute', top: -5, right: -5,
      width: 21, height: 21, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center', justifyContent: 'center',
    },

    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    addBtnOff: { opacity: 0.5 },
    addText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    addTextOff: { color: colors.textTertiary },
  })
}
