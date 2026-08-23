import React, { useMemo, useState, useEffect, useRef } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Modal, Pressable, ScrollView } from 'react-native'
// 커서가 키보드에 가릴 때만, 가린 만큼만 올려주는 컴포넌트.
// RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서 동작하지 않는다(react-native#16826).
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { createPost, updatePost, getPostForEdit } from '@/lib/board'
import { useBoardTags } from '@/hooks/useBoard'
import { useBoardEditor, BoardEditorInput, useBoardLinks, BoardLinkChips, LinkInputModal } from '@/components/BoardEditor'
import BoardRichEditor, { RICH_EDITOR_AVAILABLE, type RichEditorHandle } from '@/components/BoardRichEditor'
import PollEditor, { emptyPollDraft, durationToEndsAt, type PollDraft } from '@/components/PollEditor'
import { createPoll } from '@/lib/boardPoll'
import { MAX_IMAGES } from '@/lib/boardImage'
import { getLastNickname } from '@/lib/reviewIdentity'
import { getTermsAgreed, setTermsAgreed } from '@/lib/boardIdentity'
import { setUpdateHold } from '@/lib/appUpdates'
import { wideContent } from '@/constants/layout'

const TITLE_MAX = 60
const CONTENT_MAX = 10000

/** 리치모드 저장 시 본문 HTML 에서 <img src> 를 뽑아 image_urls 로도 넣는다(피드 썸네일·신고용). */
function extractImageUrls(html: string): string[] {
  const out: string[] = []
  const re = /<img[^>]+src=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) out.push(m[1])
  return out
}

/** 커서와 키보드(도구줄 포함) 사이에 둘 여유 */
const CARET_GAP = 8

type TagOption = { id: string; label: string }

/**
 * 글쓰기 · 수정. `?id=` 가 있으면 수정 모드.
 *
 * 화면 구조는 2026-08-01 조사한 실제 앱들을 따른다(네이버 카페·당근 동네생활·
 * 블라인드·에브리타임·X·페이스북 모두 같은 구조였다).
 *
 *   [상단 고정]  닫기 ·  글쓰기  ·  등록      ← 작성 전용 바. 로고·탭 없음
 *   [가운데]     닉네임 / 제목 / 내용        ← 키보드가 올라오면 이 영역만 좁아진다
 *   [맨 아래]    사진 첨부 도구줄            ← 키보드가 올라오면 그 위에 붙는다
 *
 * 키보드가 커서를 가릴 때의 규칙:
 *   · 안 가려지면 움직이지 않는다.
 *   · 가려질 때만, 가려진 만큼만 올린다.
 *   · 올린 뒤 커서는 키보드(+도구줄) 바로 위에 붙는다. 화면 가운데로 오지 않는다.
 * 예전에는 등록 바 높이까지 더해 올려서 필요보다 훨씬 많이 밀려 올라갔고, 제목·닉네임이
 * 화면 밖으로 사라졌다(2026-08-01 오너 지적).
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
  // 첨부(사진·GIF·유튜브) 아래에 이어 쓰는 본문. 첨부가 있을 때만 입력칸이 보인다(2026-08-21).
  const [contentBelow, setContentBelow] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [links, setLinks] = useState<string[]>([])
  // 말머리 — admin(board_tags)에서 등록한 것 중 사용 중인 것만 선택지로 보여준다
  // (2026-08-12 오너 지시). 선택은 필수가 아니다.
  const boardTags = useBoardTags()
  const [tagId, setTagId] = useState<string | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  // 수정 화면 진입 시점의 말머리가 이미 비활성화됐을 수 있다 — 그래도 '지금 선택된 것'은
  // 보여줘야 하니 라벨을 따로 들고 있는다(선택지 목록엔 없지만 항목 하나로 얹어준다).
  const [editingTag, setEditingTag] = useState<{ id: string; label: string } | null>(null)
  const tagOptions: TagOption[] = useMemo(() => {
    const base = boardTags.map((t) => ({ id: t.id, label: t.label }))
    if (!editingTag || base.some((t) => t.id === editingTag.id)) return base
    return [...base, editingTag]
  }, [boardTags, editingTag])
  const selectedTagLabel = tagId ? (tagOptions.find((t) => t.id === tagId)?.label ?? '선택 안함') : '선택 안함'
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [toolbarH, setToolbarH] = useState(0)
  const [agreed, setAgreed] = useState(false)
  // 화면 진입 시점에 이미 동의돼 있었는지 — 체크박스 자체를 보여줄지 말지는 이 값으로만
  // 정한다. `agreed`로 정하면 지금 막 체크하는 순간 조건이 바뀌어 체크박스 줄 전체가
  // 사라져 버린다(2026-08-03 오너 지적 — 체크하자마자 글이 없어짐).
  const [initiallyAgreed, setInitiallyAgreed] = useState(false)
  const [agreedLoaded, setAgreedLoaded] = useState(false)
  const editor = useBoardEditor(images, setImages)
  const linksApi = useBoardLinks(links, setLinks)
  // 리치에디터(재빌드 후 활성). 본문 HTML 은 저장 시 richRef.getHTML() 로 뽑는다.
  // richText 는 서식 뺀 평문 미러 — 등록 가능 여부·글자수 판단용.
  const richRef = useRef<RichEditorHandle>(null)
  const [richText, setRichText] = useState('')
  // 투표 초안(null=없음). 글 등록 성공 후 createPoll 로 저장(신규글만).
  const [poll, setPoll] = useState<PollDraft | null>(null)

  useEffect(() => {
    getLastNickname().then((n) => n && setNickname((cur) => cur || n))
  }, [])

  // 최초 게시물 등록 전 약관 동의 확인(애플 1.2, UGC 동의 절차). 한 번 동의하면
  // 기기에 남아 다시 묻지 않는다 — 수정 화면에서는 이미 동의한 뒤라 묻지 않는다.
  useEffect(() => {
    if (isEdit) { setAgreedLoaded(true); return }
    getTermsAgreed().then((v) => { setAgreed(v); setInitiallyAgreed(v); setAgreedLoaded(true) })
  }, [isEdit])

  useEffect(() => {
    if (!id) return
    getPostForEdit(id).then((r) => {
      if ('post' in r) {
        setNickname(r.post.nickname ?? '')
        setTitle(r.post.title ?? '')
        setContent(r.post.content ?? '')
        setContentBelow(r.post.content_below ?? '')
        setImages(r.post.image_urls ?? [])
        setLinks(r.post.link_urls ?? [])
        setTagId(r.post.tag_id ?? null)
        if (r.post.tag_id && r.post.tag_label) {
          setEditingTag({ id: r.post.tag_id, label: r.post.tag_label })
        }
      } else {
        Alert.alert('알림', r.error)
      }
      setLoading(false)
    })
  }, [id])

  const needsAgreement = !isEdit && agreedLoaded && !agreed
  // 첨부(사진·GIF·유튜브)가 하나라도 있으면 그 아래에 '이어 쓰는 본문' 입력칸을 보여준다.
  const hasAttach = images.length > 0 || links.length > 0
  // 리치모드에선 본문이 에디터 안에 있으므로 richText(평문 미러)로 판단.
  const bodyFilled = RICH_EDITOR_AVAILABLE ? richText.trim().length > 0 : content.trim().length > 0
  const canSave = nickname.trim().length >= 2 && title.trim().length > 0 && bodyFilled && !needsAgreement

  // 쓰던 게 있으면 닫기 전에 물어본다
  const dirty = title.trim().length > 0 || bodyFilled || contentBelow.trim().length > 0 || images.length > 0 || links.length > 0 || poll !== null
  // 입력 중엔 OTA 자동 새로고침을 보류 — 화면을 벗어나면(뒤로가기·등록) 즉시 풀림
  // (lib/appUpdates.ts 참고).
  useEffect(() => {
    setUpdateHold(dirty)
    return () => setUpdateHold(false)
  }, [dirty])

  const close = () => {
    if (!dirty) { router.back(); return }
    Alert.alert('작성 중인 글이 있어요', '지금 나가면 쓰던 내용이 사라집니다.', [
      { text: '계속 쓰기', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: () => router.back() },
    ])
  }

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    // 리치모드: 본문=에디터 HTML, 사진은 HTML 안에 인라인 → 썸네일·신고용으로 URL만 뽑아 imageUrls 에도 담는다.
    let bodyContent = content.trim()
    let bodyImages = images
    let bodyBelow = hasAttach ? contentBelow.trim() : ''
    if (RICH_EDITOR_AVAILABLE) {
      bodyContent = (await richRef.current?.getHTML()) ?? ''
      bodyImages = extractImageUrls(bodyContent)
      bodyBelow = ''
    }
    const r = isEdit
      ? await updatePost({ postId: id!, title: title.trim(), content: bodyContent, contentBelow: bodyBelow, imageUrls: bodyImages, linkUrls: links, tagId })
      : await createPost({ nickname: nickname.trim(), title: title.trim(), content: bodyContent, contentBelow: bodyBelow, imageUrls: bodyImages, linkUrls: links, tagId })
    if ('error' in r) { setSaving(false); Alert.alert('알림', r.error); return }
    // 신규글에 투표가 있으면 이어서 저장(항목 2개 이상 채워졌을 때만).
    if (!isEdit && poll && 'id' in r) {
      const opts = poll.options.map((o) => o.trim()).filter(Boolean)
      if (opts.length >= 2) {
        await createPoll({ postId: r.id, question: poll.question.trim(), options: opts, allowMulti: poll.allowMulti, endsAt: durationToEndsAt(poll.durationDays) })
      }
    }
    setSaving(false)
    if (!isEdit) await setTermsAgreed()
    router.back()
  }

  const full = editor.photoCount >= MAX_IMAGES

  return (
    <View style={styles.container}>
      {/* 작성 전용 상단 바. 글을 쓰는 동안 로고·탭은 두지 않는다 — 실제 앱들이 모두
          닫기 / 제목 / 등록 세 개만 둔다. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={close} hitSlop={10} style={styles.headerSide}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? '글 수정' : '글쓰기'}</Text>
        <TouchableOpacity
          onPress={save}
          disabled={!canSave || saving}
          hitSlop={10}
          style={[styles.headerSide, styles.headerRight]}
        >
          <Text style={[styles.headerAction, (!canSave || saving) && styles.headerActionOff]}>
            {isEdit ? '완료' : '등록'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[wideContent, { padding: 16, paddingBottom: 24, gap: 14 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        // 커서와 키보드 사이에 둘 거리. 키보드 위에 도구줄이 얹혀 있으니 그 높이까지만
        // 비켜준다. 이보다 크게 잡으면 필요 없이 화면이 밀려 올라간다.
        bottomOffset={toolbarH + CARET_GAP}
      >
        {/* 닉네임 · 말머리 — 한 줄에 둘 다 들어갈 폭이 남아서 같이 배치한다(2026-08-12 오너 지시).
            말머리는 종류가 늘어도 줄을 안 차지하게 콤보박스(선택 시 목록 팝업)로 고른다. */}
        <View style={styles.topRow}>
          <View style={styles.nickCol}>
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

          {(boardTags.length > 0 || editingTag) && (
            <View style={styles.tagCol}>
              <Text style={styles.label}>말머리</Text>
              <TouchableOpacity style={styles.select} onPress={() => setTagPickerOpen(true)} activeOpacity={0.75}>
                <Text style={styles.selectText} numberOfLines={1}>{selectedTagLabel}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        <TagPickerModal
          visible={tagPickerOpen}
          tags={tagOptions}
          selectedId={tagId}
          colors={colors}
          onSelect={(v) => { setTagId(v); setTagPickerOpen(false) }}
          onClose={() => setTagPickerOpen(false)}
        />

        <View>
          {/* 글자 수는 입력칸 아래가 아니라 '제목' 라벨과 같은 줄 오른쪽에 둔다
              (오너 지시 2026-08-17) — 아래에 있으면 입력칸과 다음 항목 사이가 벌어져
              보이고, 정작 입력하면서는 눈이 안 간다. */}
          <View style={styles.labelRow}>
            <Text style={[styles.label, styles.labelInRow]}>제목</Text>
            <Text style={styles.counter}>{title.length}/{TITLE_MAX}</Text>
          </View>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="제목을 입력하세요"
            placeholderTextColor={colors.textTertiary}
            maxLength={TITLE_MAX}
          />
        </View>

        <View>
          <Text style={styles.label}>내용</Text>
          {RICH_EDITOR_AVAILABLE ? (
            // 재빌드 후: 리치에디터(tentap). 본문 안에 서식·이미지 인라인. 툴바는 에디터 내부.
            <View style={styles.richBox}>
              <BoardRichEditor
                ref={richRef}
                colors={colors}
                initialHTML={content}
                placeholder="내용을 입력하세요"
                onChangeText={setRichText}
              />
            </View>
          ) : (
            <BoardEditorInput
              api={editor}
              value={content}
              onChangeText={setContent}
              images={images}
              maxLength={CONTENT_MAX}
              placeholder="내용을 입력하세요"
            />
          )}
          <View style={{ marginTop: 8 }}>
            {!RICH_EDITOR_AVAILABLE && <BoardLinkChips api={linksApi} links={links} />}
          </View>

          {/* 첨부가 있을 때만 아래에 '이어 쓰는 본문' 입력칸(기존 모드 전용). 스타일은 윗칸(본문)과 동일.
              첨부를 다 빼면 칸은 사라지되 입력한 내용은 state 에 남아(hasAttach 로 렌더만
              감춤) 다시 첨부하면 복구된다(오너 결정 2026-08-21). */}
          {!RICH_EDITOR_AVAILABLE && hasAttach && (
            <View style={{ marginTop: 12 }}>
              <TextInput
                style={styles.belowInput}
                value={contentBelow}
                onChangeText={setContentBelow}
                placeholder="사진 아래에 이어서 쓸 내용…"
                placeholderTextColor={colors.textTertiary}
                maxLength={CONTENT_MAX}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.belowHint}>
                첨부 아래에 내용을 적으면, 게시글에도 컨텐츠 밑에 텍스트가 나옵니다
              </Text>
            </View>
          )}
        </View>

        {/* 투표 — 신규글에만. 있으면 편집블록, 없으면 '투표 추가' 버튼(당근·X 방식). */}
        {!isEdit && (
          poll ? (
            <PollEditor draft={poll} onChange={setPoll} onRemove={() => setPoll(null)} />
          ) : (
            <TouchableOpacity style={styles.addPoll} onPress={() => setPoll(emptyPollDraft())} activeOpacity={0.8}>
              <Ionicons name="bar-chart-outline" size={18} color={colors.primary} />
              <Text style={styles.addPollText}>투표 추가</Text>
            </TouchableOpacity>
          )
        )}

        <Text style={styles.notice}>
          욕설·비방, 광고·홍보, 연락처가 담긴 글은 등록되지 않습니다.
        </Text>

        {!isEdit && agreedLoaded && !initiallyAgreed && (
          <View style={styles.agreeRow}>
            <TouchableOpacity
              style={styles.agreeCheck}
              onPress={() => setAgreed((v) => !v)}
              hitSlop={8}
            >
              <Ionicons
                name={agreed ? 'checkbox' : 'square-outline'}
                size={20}
                color={agreed ? colors.primary : colors.textTertiary}
              />
            </TouchableOpacity>
            <Text style={styles.agreeText}>
              게시물 관련{' '}
              <Text style={styles.agreeLink} onPress={() => router.push('/terms')}>
                이용약관
              </Text>
              에 동의합니다. (무관용 원칙, 신고 접수 후 24시간 내 조치)
            </Text>
          </View>
        )}
      </KeyboardAwareScrollView>

      {/* 사진 첨부 — 화면 맨 아랫줄. 키보드가 올라오면 그 위에 붙는다.
          네이버 카페의 '기본 도구 막대', 당근 동네생활의 '사진·장소·투표' 줄과 같은 자리.
          리치모드에선 에디터 자체 툴바가 이 역할을 하므로 숨긴다(재빌드 후). */}
      {!RICH_EDITOR_AVAILABLE && (
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View
          style={[styles.toolbar, { paddingBottom: 8 + insets.bottom }]}
          onLayout={(e) => setToolbarH(e.nativeEvent.layout.height)}
        >
          <TouchableOpacity
            style={styles.tool}
            onPress={editor.addImage}
            disabled={full || editor.uploading}
            hitSlop={8}
          >
            <Ionicons name="image-outline" size={21} color={full ? colors.textTertiary : colors.textSecondary} />
            <Text style={[styles.toolText, full && styles.toolTextOff]}>
              사진 <Text style={styles.toolTextSub}>{editor.photoCount}/{MAX_IMAGES}</Text>
            </Text>
          </TouchableOpacity>

          {/* 움짤(GIF) — 사진과 분리된 자리. 갯수가 아니라 파일당 용량으로만 제한해서
              뱃지도 "N/10"이 아니라 "(5MB)"로 보여준다(2026-08-13 오너 지시,
              2026-08-14 문구·색 조정: "GIF (5MB)", 용량 글자만 연하게). */}
          <TouchableOpacity
            style={styles.tool}
            onPress={editor.addGif}
            disabled={editor.uploading}
            hitSlop={8}
          >
            <Ionicons name="film-outline" size={21} color={colors.textSecondary} />
            <Text style={styles.toolText}>GIF <Text style={styles.toolTextSub}>(5MB)</Text></Text>
          </TouchableOpacity>

          {/* 유튜브 링크 — 갯수 제한 없음(2026-08-13 오너 지시, 스팸은 admin으로 관리).
              카운트는 안 보여준다(2026-08-14 오너 지시 — "0" 자체가 필요 없다는 지적). */}
          <TouchableOpacity
            style={styles.tool}
            onPress={linksApi.openAdd}
            hitSlop={8}
          >
            <Ionicons name="logo-youtube" size={21} color={colors.textSecondary} />
            <Text style={styles.toolText}>유튜브</Text>
          </TouchableOpacity>
        </View>
      </KeyboardStickyView>
      )}

      <LinkInputModal api={linksApi} />

      <LoadingOverlay visible={saving || loading} />
    </View>
  )
}

/** 말머리 콤보박스 팝업 — 목록이 짧아 시트가 아니라 화면 가운데 카드로 둔다(답글 팝업과 같은 방식). */
function TagPickerModal({
  visible, tags, selectedId, colors, onSelect, onClose,
}: {
  visible: boolean
  tags: TagOption[]
  selectedId: string | null
  colors: AppColors
  onSelect: (id: string | null) => void
  onClose: () => void
}) {
  const styles = useMemo(() => makeTagPickerStyles(colors), [colors])
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card}>
          <Text style={styles.title}>말머리 선택</Text>
          <ScrollView style={styles.list} bounces={false}>
            <TouchableOpacity style={styles.item} onPress={() => onSelect(null)} activeOpacity={0.7}>
              <Text style={[styles.itemText, selectedId === null && styles.itemTextOn]}>선택 안함</Text>
              {selectedId === null && <Ionicons name="checkmark" size={18} color={colors.primary} />}
            </TouchableOpacity>
            {tags.map((t) => (
              <TouchableOpacity key={t.id} style={styles.item} onPress={() => onSelect(t.id)} activeOpacity={0.7}>
                <Text style={[styles.itemText, selectedId === t.id && styles.itemTextOn]} numberOfLines={1}>
                  {t.label}
                </Text>
                {selectedId === t.id && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function makeTagPickerStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: {
      width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 16, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, paddingTop: 16, paddingBottom: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
      elevation: 12,
    },
    title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, paddingHorizontal: 16, paddingBottom: 8 },
    list: { paddingHorizontal: 6 },
    item: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 10, paddingVertical: 13, borderRadius: 10,
    },
    itemText: { fontSize: 15, color: colors.textPrimary },
    itemTextOn: { color: colors.primary, fontWeight: '700' },
  })
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 14, paddingBottom: 10,
      borderBottomWidth: 1, borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    headerSide: { minWidth: 52 },
    headerRight: { alignItems: 'flex-end' },
    headerTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    headerAction: { fontSize: 16, fontWeight: '800', color: colors.primary },
    headerActionOff: { color: colors.textTertiary },

    label: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 7 },
    // 라벨과 글자수를 한 줄에. 아래 여백은 이 줄이 갖고, 안의 label 은 marginBottom 을 0으로
    // 덮어써서 두 글자가 같은 baseline 에 놓이게 한다(label 마진이 살아 있으면 어긋난다).
    labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 },
    labelInRow: { marginBottom: 0 },
    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border,
    },
    counter: { fontSize: 11, color: colors.textTertiary },
    topRow: { flexDirection: 'row', gap: 10 },
    nickCol: { flex: 1 },
    tagCol: { flex: 1 },
    select: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      borderWidth: 1, borderColor: colors.border,
    },
    selectText: { flex: 1, fontSize: 15, color: colors.textPrimary },
    hint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 5 },
    // 아랫글 입력칸 — 본문(BoardEditor.input)과 완전히 같은 값(오너: 위아래 똑같이).
    belowInput: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 22,
      color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border, minHeight: 220,
    },
    belowHint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 6, lineHeight: 17 },
    // 리치에디터 박스(재빌드 후) — 본문 입력칸과 같은 테두리, 에디터+툴바 담김.
    richBox: { minHeight: 320, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.background },
    addPoll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
    addPollText: { fontSize: 14, color: colors.primary, fontWeight: '700' },
    notice: { fontSize: 11.5, color: colors.textTertiary, textAlign: 'center', lineHeight: 17 },

    agreeRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: colors.surfaceHigh, borderRadius: 12, padding: 12,
    },
    agreeCheck: { paddingTop: 1 },
    agreeText: { flex: 1, fontSize: 12.5, color: colors.textSecondary, lineHeight: 18 },
    agreeLink: { color: colors.primary, fontWeight: '700' },

    toolbar: {
      // 버튼이 사진·움짤·링크 3개로 늘어(2026-08-13) 좁은 화면에서도 안 밀리게 간격을 줄임.
      flexDirection: 'row', alignItems: 'center', gap: 14,
      paddingHorizontal: 14, paddingTop: 8,
      backgroundColor: colors.surface,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
    toolText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    toolTextOff: { color: colors.textTertiary },
    // 갯수·용량 표시만 연하게(2026-08-14 오너 지시) — 라벨과 구분되게.
    toolTextSub: { color: colors.textTertiary, fontWeight: '500' },
  })
}
