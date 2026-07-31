import React, { useMemo, useState, useEffect } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native'
// RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서 동작하지 않는다(react-native#16826).
// 포커스된 칸을 키보드 위로 스크롤해 주는 이 컴포넌트가 현재 표준이다.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { createPost, updatePost } from '@/lib/board'
import { useBoardEditor, BoardEditorInput, BoardEditorToolbar } from '@/components/BoardEditor'
import { getLastNickname } from '@/lib/reviewIdentity'
import { wideContent } from '@/constants/layout'

const TITLE_MAX = 60
const CONTENT_MAX = 10000

/**
 * 글쓰기 · 수정. `?id=` 가 있으면 수정 모드.
 * 닉네임은 후기와 같은 저장소를 써서 한 번 쓰면 다음부터 자동으로 채워진다.
 */
export default function BoardWriteScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const isEdit = !!id

  const [nickname, setNickname] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const editor = useBoardEditor(content, setContent, images, setImages)

  useEffect(() => {
    getLastNickname().then((n) => n && setNickname((cur) => cur || n))
  }, [])

  useEffect(() => {
    if (!id) return
    supabase.from('board_posts').select('nickname,title,content,image_urls').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setNickname((data as any).nickname ?? '')
          setTitle((data as any).title ?? '')
          setContent((data as any).content ?? '')
          setImages((data as any).image_urls ?? [])
        }
        setLoading(false)
      }, () => setLoading(false))
  }, [id])

  const canSave = nickname.trim().length >= 2 && title.trim().length > 0 && content.trim().length > 0

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    const r = isEdit
      ? await updatePost({ postId: id!, title: title.trim(), content: content.trim(), imageUrls: images })
      : await createPost({ nickname: nickname.trim(), title: title.trim(), content: content.trim(), imageUrls: images })
    setSaving(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    router.back()
  }

  return (
    <View style={styles.container}>
      {/* 애플 가이드라인: 이 화면의 주 동작은 상단 내비게이션 바에 둔다.
          키보드 위 액세서리는 서식 도구 자리다(2026-07-31 조사·오너 지적). */}
      <TopBar
        showBack
        onLogoPress={() => router.replace('/board')}
        rightAction={{
          label: isEdit ? '완료' : '등록',
          onPress: save,
          disabled: !canSave || saving,
        }}
      />
      <View style={{ flex: 1 }}>
        <KeyboardAwareScrollView
          contentContainerStyle={[wideContent, { padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // 커서가 키보드 바로 위에 붙지 않게 띄우는 여백
          bottomOffset={24}
        >
          <Text style={styles.heading}>{isEdit ? '글 수정' : '글쓰기'}</Text>

          <View>
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              style={styles.input}
              value={nickname}
              onChangeText={setNickname}
              placeholder="2~20자"
              placeholderTextColor={colors.textTertiary}
              maxLength={20}
              editable={!isEdit}
            />
            {isEdit && <Text style={styles.hint}>닉네임은 수정할 수 없습니다</Text>}
          </View>

          <View>
            <Text style={styles.label}>제목</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="제목을 입력하세요"
              placeholderTextColor={colors.textTertiary}
              maxLength={TITLE_MAX}
            />
            <Text style={styles.counter}>{title.length}/{TITLE_MAX}</Text>
          </View>

          <View>
            <Text style={styles.label}>내용</Text>
            <BoardEditorInput
              api={editor}
              value={content}
              onChangeText={setContent}
              images={images}
              maxLength={CONTENT_MAX}
              placeholder="내용을 입력하세요"
            />
          </View>

          <Text style={styles.notice}>
            욕설·비방, 광고·홍보, 연락처가 담긴 글은 등록되지 않습니다.
          </Text>
        </KeyboardAwareScrollView>
      </View>

      {/* 서식 도구 — 키보드 위에 붙는다. 스크롤 밖에 둬야 키보드가 덮지 않는다. */}
      <BoardEditorToolbar api={editor} bottomInset={insets.bottom} />

      <LoadingOverlay visible={saving || loading} />
    </View>
  )
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    heading: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.4 },
    label: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 7 },
    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border,
    },
    textArea: { minHeight: 220 },
    counter: { fontSize: 11, color: colors.textTertiary, textAlign: 'right', marginTop: 5 },
    hint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 5 },
    saveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    saveBtnOff: { backgroundColor: colors.border },
    saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    saveBtnTextOff: { color: colors.textTertiary },
    notice: { fontSize: 11.5, color: colors.textTertiary, textAlign: 'center', lineHeight: 17 },
  })
}
