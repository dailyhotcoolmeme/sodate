import React, { useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Modal, Pressable } from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { pickAndUpload, pickAndUploadMany, MAX_IMAGES, isGifUrl } from '@/lib/boardImage'
import { youtubeId, youtubeThumbnail } from '@/lib/youtube'
import { isInstagramUrl } from '@/lib/instagram'
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
  // 사진 10장 제한은 움짤을 빼고 센다 — 움짤은 갯수가 아니라 파일당 5MB로만
  // 제한한다(2026-08-13 오너 지시). 별도 상태 없이 URL 확장자로 구분한다.
  const photoCount = images.filter((u) => !isGifUrl(u)).length

  // 한 번에 여러 장을 골라 **고른 순서대로** 붙인다(2026-08-21 오너 지시). 예전엔
  // 한 장씩 반복해야 했다. 지금 더 받을 수 있는 장수만큼만 받고, 초과분·실패분은 알려준다.
  const addImage = async () => {
    const remaining = MAX_IMAGES - photoCount
    if (remaining <= 0) {
      Alert.alert('알림', `사진은 ${MAX_IMAGES}장까지 올릴 수 있어요.`)
      return
    }
    setUploading(true)
    const r = await pickAndUploadMany(remaining)
    setUploading(false)
    if (!r) return
    // 성공한 건 순서 그대로 먼저 붙이고, 안내가 있으면(초과·실패) 그다음에 띄운다.
    if (r.urls.length) onChangeImages([...images, ...r.urls])
    if (r.error) Alert.alert('알림', r.error)
  }

  const addGif = async () => {
    setUploading(true)
    const r = await pickAndUpload('gif')
    setUploading(false)
    if (!r) return
    if ('error' in r) { Alert.alert('알림', r.error); return }
    onChangeImages([...images, r.url])
  }

  return {
    inputRef,
    addImage,
    addGif,
    photoCount,
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
  // 썸네일 누르면 전체보기(2026-08-14 오너 지시) — X 버튼과는 별도 터치 영역이라 겹치지 않는다.
  const [previewUri, setPreviewUri] = useState<string | null>(null)

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
              <TouchableOpacity onPress={() => setPreviewUri(u)} activeOpacity={0.85}>
                <Image source={{ uri: u }} style={styles.thumb} contentFit="cover" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.thumbX} onPress={() => api.removeImage(u)} hitSlop={6}>
                <Ionicons name="close" size={13} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!previewUri} transparent animationType="fade" onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={styles.previewOverlay} onPress={() => setPreviewUri(null)}>
          {!!previewUri && (
            <Image source={{ uri: previewUri }} style={styles.previewImage} contentFit="contain" />
          )}
          <TouchableOpacity style={styles.previewClose} onPress={() => setPreviewUri(null)} hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
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

    // X 버튼이 썸네일 밖으로 튀어나온다(top:-5, right:-5). 그만큼 컨테이너에 여백을 줘야
    // 잘리지 않는다. 위쪽은 paddingTop 8로 해결했었는데(2026-08-14), 오른쪽 여백이 없어
    // **맨 끝 썸네일의 X 버튼이 스크롤 끝에서 잘렸다**(2026-08-21 오너 지적). 오른쪽에도
    // 버튼이 튀어나온 만큼(약 6) 여백을 준다.
    thumbs: { gap: 8, paddingTop: 8, paddingBottom: 2, paddingRight: 8 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: colors.surfaceHigh },
    thumbX: {
      position: 'absolute', top: -5, right: -5,
      width: 21, height: 21, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center', justifyContent: 'center',
    },

    previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    previewImage: { width: '100%', height: '80%' },
    previewClose: {
      position: 'absolute', top: 50, right: 20,
      width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center',
    },
  })
}

/**
 * 게시판 유튜브·인스타그램 링크 첨부(2026-08-13 유튜브, 2026-08-24 인스타 추가). 인앱
 * 재생은 안 하고 외부(유튜브/인스타 앱 또는 브라우저)에서 열람. 유튜브는 썸네일을
 * img.youtube.com URL 패턴으로 API 호출 없이 바로 만들고, 인스타는 공개 썸네일 규칙이
 * 없어 아이콘 자리표시로 대신한다(lib/instagram.ts 참고).
 *
 * 갯수 제한은 두지 않는다(2026-08-13 오너 지시) — 아웃링크라 서버 비용이 없고,
 * 스팸 여부는 신고·차단 등 admin 운영으로 관리한다.
 */
export type LinkMode = 'youtube' | 'instagram'

// onInsertToContent — 리치 에디터 본문 안에도 같이 넣어달라는 오너 지시(2026-08-25:
// "첨부 컨텐츠들은 모두 본문 내부에 넣게 하라고!! 왜 이걸 해결을 못하냐고" — 사진은
// 본문 안, 유튜브·인스타는 밖(첨부 갤러리)이라 자리가 갈렸었다). 아래 썸네일 갤러리
// (BoardLinkChips, 상세페이지 재생 썸네일)는 그대로 두고, 본문에도 넣는다.
// ⚠️(2026-08-25) 처음엔 본문에 링크 텍스트(주소 문자열)만 넣었는데, 오너가 "저게
// 썸네일 유튜브라고 생각하냐!!" 라고 지적 — 맞는 말이다, 주소만 덜렁 있으면 유튜브인지
// 알 수가 없다. mode 를 같이 넘겨서 write.tsx 가 유튜브면 실제 썸네일 이미지까지 본문에
// 넣게 한다(인스타는 공개 썸네일 URL 규칙이 없어 링크 텍스트까지만 가능).
export function useBoardLinks(links: string[], onChangeLinks: (next: string[]) => void, onInsertToContent?: (url: string, mode: LinkMode) => void) {
  const [modalVisible, setModalVisible] = useState(false)
  const [mode, setMode] = useState<LinkMode>('youtube')
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const openAdd = (m: LinkMode = 'youtube') => {
    setMode(m)
    setInput('')
    setError(null)
    setModalVisible(true)
  }
  const confirmAdd = () => {
    const url = input.trim()
    const valid = mode === 'youtube' ? !!youtubeId(url) : isInstagramUrl(url)
    if (!valid) {
      setError(
        mode === 'youtube'
          ? '유튜브 링크만 첨부할 수 있어요. (youtube.com, youtu.be)'
          : '인스타그램 게시물·릴스 링크만 첨부할 수 있어요. (instagram.com/p/... 또는 /reel/...)'
      )
      return
    }
    if (!links.includes(url)) onChangeLinks([...links, url])
    onInsertToContent?.(url, mode)
    setModalVisible(false)
  }

  return {
    modalVisible, mode, input, setInput, error, openAdd, confirmAdd,
    cancel: () => setModalVisible(false),
    removeLink: (u: string) => onChangeLinks(links.filter((x) => x !== u)),
  }
}

export type BoardLinksApi = ReturnType<typeof useBoardLinks>

/** 첨부된 링크를 이미지 썸네일과 같은 자리에 보여준다. 유튜브=썸네일+재생배지, 인스타=아이콘 자리표시. */
export function BoardLinkChips({ api, links }: { api: BoardLinksApi; links: string[] }) {
  const colors = useColors()
  const styles = useMemo(() => makeLinkStyles(colors), [colors])
  if (links.length === 0) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
      {links.map((u) => {
        const ig = isInstagramUrl(u)
        return (
          <View key={u} style={styles.thumbWrap}>
            {ig ? (
              <View style={[styles.thumb, styles.igThumb]}>
                <Ionicons name="logo-instagram" size={26} color={colors.textSecondary} />
              </View>
            ) : (
              <>
                <Image source={{ uri: youtubeThumbnail(u) ?? undefined }} style={styles.thumb} contentFit="cover" />
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={12} color="#fff" />
                </View>
              </>
            )}
            <TouchableOpacity style={styles.thumbX} onPress={() => api.removeLink(u)} hitSlop={6}>
              <Ionicons name="close" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
        )
      })}
    </ScrollView>
  )
}

/** 유튜브·인스타 URL 붙여넣기 팝업 — write.tsx의 말머리 선택 팝업과 같은 방식(화면 가운데 카드). */
export function LinkInputModal({ api }: { api: BoardLinksApi }) {
  const colors = useColors()
  const styles = useMemo(() => makeLinkStyles(colors), [colors])
  const isYoutube = api.mode === 'youtube'
  return (
    <Modal visible={api.modalVisible} transparent animationType="fade" onRequestClose={api.cancel} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={api.cancel} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{isYoutube ? '유튜브 링크 추가' : '인스타그램 링크 추가'}</Text>
          <TextInput
            style={styles.modalInput}
            value={api.input}
            onChangeText={api.setInput}
            placeholder={isYoutube ? 'https://youtube.com/watch?v=...' : 'https://instagram.com/p/...'}
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {!!api.error && <Text style={styles.modalError}>{api.error}</Text>}
          <View style={styles.modalBtnRow}>
            <TouchableOpacity style={styles.modalBtn} onPress={api.cancel} activeOpacity={0.75}>
              <Text style={styles.modalBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={api.confirmAdd} activeOpacity={0.85}>
              <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>추가</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeLinkStyles(colors: AppColors) {
  return StyleSheet.create({
    // 사진 썸네일과 같은 이유(위 makeStyles 참고) — X 버튼이 위로 튀어나오니 위쪽 여백을 더 준다.
    thumbs: { gap: 8, paddingTop: 8, paddingBottom: 2, paddingRight: 8 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: colors.surfaceHigh },
    // 인스타는 공개 썸네일 규칙이 없어 아이콘 자리표시로 대신한다.
    igThumb: { alignItems: 'center', justifyContent: 'center' },
    playBadge: {
      position: 'absolute', right: 4, bottom: 4,
      width: 20, height: 20, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center', justifyContent: 'center',
    },
    thumbX: {
      position: 'absolute', top: -5, right: -5,
      width: 21, height: 21, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center', justifyContent: 'center',
    },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: {
      width: '100%', maxWidth: 360, borderRadius: 16, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
      elevation: 12,
    },
    modalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    modalInput: {
      backgroundColor: colors.surfaceHigh, borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border,
    },
    modalError: { fontSize: 12, color: colors.error },
    modalBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    modalBtn: {
      flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center',
      backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    },
    modalBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    modalBtnText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    modalBtnTextPrimary: { color: '#fff' },
  })
}
