import React, { useMemo, useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Platform,
  Keyboard, Dimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { supabase } from '@/lib/supabase'
import { createPost, updatePost } from '@/lib/board'
import BoardEditor from '@/components/BoardEditor'
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

  // ── 키보드 가림 ──────────────────────────────────────────────────────────
  // 파킨온에서 이미 검증한 패턴을 그대로 쓴다(PostWriteScreen).
  // 핵심: ScrollView 는 여러 줄 입력칸의 '커서'를 따라가지 않는다. 입력칸이 자라는 것과
  // 커서가 보이는 것은 별개이고, 문제는 후자다. KeyboardAvoidingView 로 화면을 통째로
  // 밀어 올리는 방식은 본문처럼 칸이 큰 경우 커서를 못 따라간다(2026-08-01 오너 지적).
  //   · iOS   : ScrollView 의 automaticallyAdjustKeyboardInsets 가 처리
  //   · 안드로이드: 키보드 높이만큼 맨 아래 스페이서 + 커서 줄을 키보드 위로 끌어올리기
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<TextInput>(null)
  const scrollY = useRef(0)
  const kbHeightRef = useRef(0)
  const contentFocused = useRef(false)
  const [kbHeight, setKbHeight] = useState(0)

  // 본문 입력칸 하단(= 마지막 줄·커서 근사)을 화면 절대좌표로 재서,
  // 키보드 윗선보다 내려간 만큼만 스크롤한다. 본문 뒤에 사진·버튼이 이어지므로
  // scrollToEnd 는 너무 많이 내려가 부적합하다.
  const scrollCursorIntoView = () => {
    if (Platform.OS !== 'android' || kbHeightRef.current === 0) return
    const node = contentRef.current as any
    if (!node?.measureInWindow) return
    node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const keyboardTop = Dimensions.get('window').height - kbHeightRef.current
      const overflow = y + h - keyboardTop + 24
      if (overflow > 0) scrollRef.current?.scrollTo({ y: scrollY.current + overflow, animated: true })
    })
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const h = e.endCoordinates?.height ?? 0
      setKbHeight(h)
      kbHeightRef.current = h
      if (contentFocused.current) setTimeout(scrollCursorIntoView, 60)
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKbHeight(0)
      kbHeightRef.current = 0
    })
    return () => { show.remove(); hide.remove() }
  }, [])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)

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
      <TopBar showBack onLogoPress={() => router.replace('/board')} />
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[wideContent, { padding: 16, paddingBottom: insets.bottom + 24, gap: 14 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={16}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y }}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
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
            <BoardEditor
              inputRef={contentRef}
              value={content}
              onChangeText={setContent}
              images={images}
              onChangeImages={setImages}
              maxLength={CONTENT_MAX}
              placeholder="내용을 입력하세요"
              onFocus={() => { contentFocused.current = true; setTimeout(scrollCursorIntoView, 60) }}
              onBlur={() => { contentFocused.current = false }}
              onCaretMove={scrollCursorIntoView}
            />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, !canSave && styles.saveBtnOff]}
            onPress={save}
            disabled={!canSave || saving}
          >
            <Text style={[styles.saveBtnText, !canSave && styles.saveBtnTextOff]}>
              {isEdit ? '수정 완료' : '등록'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.notice}>
            욕설·비방, 광고·홍보, 연락처가 담긴 글은 등록되지 않습니다.
          </Text>
          {/* 안드로이드는 키보드가 창을 줄이지 않고 inset 으로 들어온다(edge-to-edge).
              맨 아래에 키보드 높이만큼 자리를 만들어야 끌어올릴 공간이 생긴다. */}
          {kbHeight > 0 && <View style={{ height: kbHeight }} />}
        </ScrollView>
      </View>

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
