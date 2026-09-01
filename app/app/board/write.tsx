import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Modal, Pressable, ScrollView, Keyboard } from 'react-native'
// 커서가 키보드에 가릴 때만, 가린 만큼만 올려주는 컴포넌트.
// RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서 동작하지 않는다(react-native#16826).
import { KeyboardAwareScrollView, KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { createPost, updatePost, getPostForEdit } from '@/lib/board'
import { useBoardTags } from '@/hooks/useBoard'
import { useBoardEditor, BoardEditorInput, BoardImageChips, useBoardLinks, BoardLinkChips, LinkInputModal } from '@/components/BoardEditor'
import BoardRichEditor, { type RichEditorHandle } from '@/components/BoardRichEditor'
import BoardRichToolbar, { type ToolbarButton } from '@/components/BoardRichToolbar'
import type { RichEditorState } from '@/components/BoardRichEditorImpl'
import PollEditor, { emptyPollDraft, durationToEndsAt, type PollDraft } from '@/components/PollEditor'
import { createPoll } from '@/lib/boardPoll'
import { VIDEO_ENABLED, pickCompressUploadVideo } from '@/lib/boardVideo'
import { MAX_IMAGES, pickAndUpload, pickAndUploadMany } from '@/lib/boardImage'
import { getLastNickname } from '@/lib/reviewIdentity'
import { getTermsAgreed, setTermsAgreed } from '@/lib/boardIdentity'
import { setUpdateHold } from '@/lib/appUpdates'
import { wideContent } from '@/constants/layout'

const TITLE_MAX = 60
const CONTENT_MAX = 10000

/** 커서와 키보드(도구줄 포함) 사이에 둘 여유 */
const CARET_GAP = 8

/** 리치 에디터 인라인 링크(setLink)용 — 프로토콜 없이 입력해도 https:// 를 붙여준다. */
function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

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
  // ⚠️(2026-08-25) 입력박스(richBox) 안에 웹뷰 자체 스크롤(scrollEnabled)을 켰더니,
  // 바깥 페이지 스크롤(KeyboardAwareScrollView)이랑 동시에 터치를 붙잡으려고 해서
  // 서로 충돌났다(오너 지적: "입력박스 안쪽이랑 바깥쪽 전체 스크롤바가 서로 충돌
  // 나서 이거 해결 안 된다니까?"). 손가락이 박스 안에 닿아있는 동안만 바깥 스크롤을
  // 잠가서(터치 시작~끝) 그 순간엔 안쪽 스크롤만 반응하게 하고, 손을 떼면 다시
  // 바깥 스크롤이 정상 동작하게 한다 — 중첩 스크롤 충돌의 표준 해결 방식.
  const [richBoxTouching, setRichBoxTouching] = useState(false)
  const [agreed, setAgreed] = useState(false)
  // 화면 진입 시점에 이미 동의돼 있었는지 — 체크박스 자체를 보여줄지 말지는 이 값으로만
  // 정한다. `agreed`로 정하면 지금 막 체크하는 순간 조건이 바뀌어 체크박스 줄 전체가
  // 사라져 버린다(2026-08-03 오너 지적 — 체크하자마자 글이 없어짐).
  const [initiallyAgreed, setInitiallyAgreed] = useState(false)
  const [agreedLoaded, setAgreedLoaded] = useState(false)
  const editor = useBoardEditor(images, setImages)
  // 리치에디터(재빌드 후 활성). 본문 HTML 은 저장 시 richRef.getHTML() 로 뽑는다.
  // richText 는 서식 뺀 평문 미러 — 등록 가능 여부·글자수 판단용.
  const richRef = useRef<RichEditorHandle>(null)
  // ⚠️(2026-08-25) 스와이프·바깥 탭으로 소프트 키보드를 닫아도 웹뷰 안 커서(DOM
  // 포커스)는 안 지워진다 — 키보드 없이 커서(+iOS17 물방울 손잡이)만 화면에 남는
  // 사고가 났다(오너 지적: "이게 뭐냐고!!"). 키보드가 실제로 닫힐 때마다(경로 상관
  // 없이) editor.blur() 로 웹뷰 DOM 포커스까지 같이 내린다.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => richRef.current?.blur())
    return () => sub.remove()
  }, [])
  // ⚠️(2026-08-26) 키보드 위 툴바를 react-native-keyboard-controller 의
  // KeyboardStickyView 로 고정했는데, 안드 실기기에서 툴바 전체가 아예 안 보이는
  // 사고가 났다 — BlurView 를 빼도 그대로였다(외부 AI 3곳 교차검증으로 BlurView는
  // 무죄 확정). 그 컴포넌트(KeyboardStickyView) 자체를 걷어내고 RN 코어
  // `Keyboard.addListener('keyboardDidShow', ...)` 로 직접 높이를 재는 방식으로
  // 바꿨더니, 이번엔 그 이벤트 자체가 최신 안드(엣지투엣지) 에서 전혀 안 와서
  // 툴바가 키보드를 안 따라가고 화면 맨 아래에 고정되는 사고가 났다(오너 제보:
  // "바닥에 있는게 키보드랑 같이 올라오질 않고 고정되어 있다"). 그 다음 JS 상태
  // 기반 `useKeyboardState` 로 바꿔서 키보드를 따라가긴 했지만, 매 프레임 JS
  // 스레드 리렌더로 위치를 갱신하는 구조라 네이티브 키보드 애니메이션보다 반박자
  // 늦게 움직였다(오너 제보: "키보드보다 반박자 느리게 따라온다. 닫을때도
  // 그렇다"). UI 스레드에서 직접 애니메이션 값을 받는 reanimated 기반
  // `useReanimatedKeyboardAnimation` (KeyboardStickyView 가 내부적으로 쓰는 것과
  // 같은 훅)으로 다시 바꾼다 — 문제였던 컴포넌트(KeyboardStickyView)만 피하고,
  // 그 컴포넌트가 쓰던 것과 같은 저수준 애니메이션 값은 그대로 재사용한다.
  const { height: kbHeightSV } = useReanimatedKeyboardAnimation()
  // ⚠️(2026-08-26 오너 지적: "안드 3버튼 생각을 안하냐?") 안드 3버튼 네비게이션
  // 기기 일부에서 키보드 높이가 실제보다 작게(3버튼 바 높이만큼 빠진 값으로)
  // 잘못 잡히는 사례가 있다 — 키보드가 닫혀 있거나 그 높이가 3버튼 바 높이보다
  // 작을 때는 최소한 3버튼 바 높이(insets.bottom)만큼은 띄운다. 이 프로젝트에서
  // 안드 3버튼을 깜빡해서 사고 낸 게 이번이 처음이 아니다(입력박스 높이, 약관
  // 체크박스 잘림) — 매번 새로 지적받지 않도록 "화면 맨 아래 관련 계산은 항상
  // 3버튼 네비게이션까지 감안" 을 메모리에 박아둔다.
  // kbHeightSV.value 는 0(닫힘) 또는 음수(-키보드 높이)이므로, -insets.bottom 과
  // 비교해 더 (음의 방향으로) 큰 쪽을 쓰면 "닫힘일 때 최소 insets.bottom"과
  // "키보드가 더 크면 키보드 높이 그대로" 두 경우를 한 식으로 처리한다.
  const richToolbarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(kbHeightSV.value, -insets.bottom) }],
  }), [insets.bottom])
  // 사진·유튜브·인스타 모두 본문(리치 에디터) 안에는 넣지 않고, 유튜브 링크와 같은 자리
  // (게시글 본문 밑 첨부 갤러리)에만 썸네일로 붙인다(2026-08-25 오너 지시: "모든 컨텐츠
  // 첨부는 유튜브처럼 썸네일로 박스 밖에 첨부하게 하자. 아주 심플하게"). 예전에 "첨부는
  // 다 본문 안에" 로 반대로 갔다가(사진은 안, 링크는 밖이라 자리가 갈렸던 걸 통일하려던
  // 시도) 오히려 복잡해져서 다시 원래(단순) 방식으로 되돌렸다 — 링크는 그냥 links 배열에만
  // 추가(useBoardLinks 자체가 처리), 본문 삽입 콜백은 넘기지 않는다.
  const linksApi = useBoardLinks(links, setLinks)
  const [richText, setRichText] = useState('')
  // 에디터가 마운트되면 한 번 알려준다 — 그 전엔 키보드 위 툴바를 그리지 않는다
  // (react-native-enriched-html은 tentap 웹뷰와 달리 비동기 로드가 없어 거의 즉시 옴).
  const [richReady, setRichReady] = useState(false)
  // 굵게·기울임·밑줄 버튼 활성 표시용(react-native-enriched-html onChangeState).
  const [richState, setRichState] = useState<RichEditorState>(null)
  const richMode = true
  const fallbackToLegacy = useCallback((_reason?: string) => { setContent((c) => c || richText) }, [richText])

  // 리치모드 사진·GIF — 골라 R2 업로드 후 에디터 본문에 인라인 삽입.
  const [richUploading, setRichUploading] = useState(false)
  // 여러 장 올릴 때 "2/5장 올리는 중" 표시용(오너 지시 — 위 pickAndUploadMany 참고).
  const [richUploadProgress, setRichUploadProgress] = useState<{ current: number; total: number } | null>(null)
  // ⚠️(2026-08-25) pickAndUpload 는 사진 선택 권한 요청·사진첩 열기 단계가 try/catch
  // 밖에 있어서(lib/boardImage.ts), 거기서 예외가 나면(권한 팝업 타이밍 문제 등) 이
  // 함수가 setRichUploading(false) 를 실행하기 전에 그대로 던져버렸다 — 그러면
  // richUploading 이 true 로 영원히 남아서 사진·GIF 버튼이 그 글쓰기 화면을 나갈
  // 때까지 계속 죽어있었다(오너 지적: "이제는 이미지 눌러도 반응이 없다. 이미지
  // 첨부 자체를 못하는 상태라고!!!" — 한 번이라도 예외가 나면 영구 고장). try/finally
  // 로 감싸서 무슨 일이 있어도 버튼이 다시 눌리게 한다.
  // 리치모드에서도 사진은 본문 안이 아니라 images 배열(썸네일 갤러리)로만 들어간다
  // (위 linksApi 주석 참고 — 2026-08-25 오너 지시로 인라인 삽입을 되돌렸다).
  const insertRichMedia = async (mode: 'photo' | 'gif') => {
    if (richUploading) return
    // 이미 붙은 장수만큼 빼고 받는다(기존 단순모드 addImage 와 동일한 규칙).
    const remaining = MAX_IMAGES - editor.photoCount
    if (mode === 'photo' && remaining <= 0) {
      Alert.alert('알림', `사진은 ${MAX_IMAGES}장까지 올릴 수 있어요.`)
      return
    }
    setRichUploading(true)
    try {
      // 사진은 한 번에 여러 장 골라 순서대로 넣는다(오너 지적: "이미지 첨부할때 왜
      // 하나씩 밖에 안되는데!!" — 기존 첨부 방식(boardImage.ts pickAndUploadMany)을
      // 그대로 재사용). 움짤은 원래대로 한 장씩(용량 제한이 파일당이라 다르게 다룸).
      if (mode === 'photo') {
        const r = await pickAndUploadMany(remaining, (current, total) => setRichUploadProgress({ current, total }))
        if (r) {
          if (r.urls.length) setImages((prev) => [...prev, ...r.urls])
          if (r.error) Alert.alert('알림', r.error)
          else if (r.skipped > 0) Alert.alert('알림', `한 번에 최대 ${MAX_IMAGES}장까지만 넣을 수 있어서 ${r.skipped}장은 빠졌어요.`)
        }
      } else {
        const r = await pickAndUpload(mode)
        if (r && 'url' in r) setImages((prev) => [...prev, r.url])
        else if (r && 'error' in r) Alert.alert('알림', r.error)
      }
    } catch {
      Alert.alert('알림', '사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.')
    } finally {
      setRichUploading(false)
      setRichUploadProgress(null)
    }
  }
  // 투표 초안(null=없음). 글 등록 성공 후 createPoll 로 저장(신규글만).
  const [poll, setPoll] = useState<PollDraft | null>(null)

  // 리치 툴바 — 사진·유튜브·굵게·기울임·밑줄·취소선·인용구·순서목록·비순서목록·
  // 체크박스목록·링크 한 줄, 키보드 바로 위에 고정(오너 지시 2026-08-25: "키보드
  // 위 방식으로 하자"). 취소선~링크는 2026-08-26 오너 승인으로 추가(아티팩트
  // 미리보기로 실제 렌더링 확인 후 6개만 골라 승인받음). 글자색·배경색은 새 에디터
  // (react-native-enriched-html)에 아직 없어서 뺐다(오너에게 사전 보고·승인 완료).
  // 되돌리기(undo)도 이 라이브러리 ref API에 없어서 뺐다 — 기기 자체 되돌리기에 맡긴다.
  const full = editor.photoCount >= MAX_IMAGES
  // 링크 삽입 팝업 상태 — 유튜브/인스타 링크(useBoardLinks)와는 별개다. 그건 본문
  // 밖 썸네일용이고, 이건 본문 텍스트 중간에 거는 하이퍼링크(setLink)용이다.
  const [linkModal, setLinkModal] = useState<{ visible: boolean; sel: { start: number; end: number }; text: string; url: string; error: string | null; wasActive: boolean }>(
    { visible: false, sel: { start: 0, end: 0 }, text: '', url: '', error: null, wasActive: false },
  )
  const openInlineLinkModal = () => {
    const sel = richRef.current?.getSelection() ?? { start: 0, end: 0, text: '' }
    setLinkModal({ visible: true, sel: { start: sel.start, end: sel.end }, text: sel.text, url: '', error: null, wasActive: !!richState?.link.isActive })
  }
  const confirmInlineLink = () => {
    const url = normalizeUrl(linkModal.url)
    if (!url) { setLinkModal((m) => ({ ...m, error: '링크 주소를 입력해주세요.' })); return }
    const text = linkModal.text.trim() || url
    richRef.current?.setLink(linkModal.sel.start, linkModal.sel.end, text, url)
    setLinkModal((m) => ({ ...m, visible: false }))
  }
  const removeInlineLink = () => {
    richRef.current?.removeLink(linkModal.sel.start, linkModal.sel.end)
    setLinkModal((m) => ({ ...m, visible: false }))
  }
  const toolbarButtons: ToolbarButton[] = useMemo(() => [
    { key: 'photo', icon: 'photo', disabled: richUploading || full, onPress: () => insertRichMedia('photo') },
    { key: 'youtube', icon: 'youtube', onPress: () => linksApi.openAdd('youtube') },
    { key: 'bold', icon: 'bold', active: !!richState?.bold.isActive, onPress: () => richRef.current?.toggleBold() },
    { key: 'italic', icon: 'italic', active: !!richState?.italic.isActive, onPress: () => richRef.current?.toggleItalic() },
    { key: 'underline', icon: 'underline', active: !!richState?.underline.isActive, onPress: () => richRef.current?.toggleUnderline() },
    { key: 'strike', icon: 'strike', active: !!richState?.strikeThrough.isActive, onPress: () => richRef.current?.toggleStrikeThrough() },
    { key: 'quote', icon: 'quote', active: !!richState?.blockQuote.isActive, onPress: () => richRef.current?.toggleBlockQuote() },
    { key: 'orderedList', icon: 'orderedList', active: !!richState?.orderedList.isActive, onPress: () => richRef.current?.toggleOrderedList() },
    { key: 'unorderedList', icon: 'unorderedList', active: !!richState?.unorderedList.isActive, onPress: () => richRef.current?.toggleUnorderedList() },
    { key: 'checkbox', icon: 'checkbox', active: !!richState?.checkboxList.isActive, onPress: () => richRef.current?.toggleCheckboxList() },
    { key: 'link', icon: 'link', active: !!richState?.link.isActive, onPress: openInlineLinkModal },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [richUploading, full, richState])
  // 동영상(숨김 기능 — VIDEO_ENABLED=false 라 버튼 안 보임). R2 업로드 URL 목록.
  const [videos, setVideos] = useState<string[]>([])
  const [videoBusy, setVideoBusy] = useState(false)

  // 닉네임은 MY 공용값. 화면 올 때마다(포커스) 최신값 반영 — MY에서 바꾸고 돌아오면 갱신.
  useFocusEffect(useCallback(() => {
    getLastNickname().then((n) => setNickname(n || ''))
  }, []))

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
  // 리치모드에선 본문이 에디터 안에 있으므로 richText(평문 미러)로 판단.
  const bodyFilled = richMode ? richText.trim().length > 0 : content.trim().length > 0
  const canSave = nickname.trim().length >= 2 && title.trim().length > 0 && bodyFilled && !needsAgreement

  // 쓰던 게 있으면 닫기 전에 물어본다
  const dirty = title.trim().length > 0 || bodyFilled || images.length > 0 || links.length > 0 || poll !== null || videos.length > 0
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
    // 사진·링크는 이제 모드와 상관없이 항상 images/links 배열(썸네일 갤러리)에서 그대로
    // 가져온다 — 리치모드도 본문 HTML 안에 <img> 를 넣지 않으니 따로 뽑아낼 게 없다.
    let bodyContent = content.trim()
    const bodyImages = images
    if (richMode) {
      bodyContent = (await richRef.current?.getHTML()) ?? ''
    }
    const r = isEdit
      ? await updatePost({ postId: id!, title: title.trim(), content: bodyContent, imageUrls: bodyImages, linkUrls: links, tagId })
      : await createPost({ nickname: nickname.trim(), title: title.trim(), content: bodyContent, imageUrls: bodyImages, linkUrls: links, videoUrls: videos, tagId })
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
        // 안드로이드 3버튼 내비게이션 바가 화면 맨 밑을 가려서 약관 동의 체크박스가
        // 잘렸다(오너 지적: "안드폰 3버튼 감안해서 맨 밑에 약관 동의 체크박스 부분
        // 높이 맞춰라. 밑에 잘렸다"). insets.bottom 을 더해서 그 높이만큼 여유를 둔다.
        // ⚠️(2026-08-26) 리치 툴바가 키보드 유무와 상관없이 항상 화면 맨 아래에 떠
        // 있는데(서식 버튼 상시 접근용), 이 여백 계산에 툴바 높이(toolbarH)가 안 빠져
        // 있어서 마지막 줄이 툴바 뒤에 가려진 채 스크롤이 거기서 멈췄다(오너 제보:
        // "키보드를 닫아도 바닥에 항상 있고 뒤쪽 글자를 가린다... 스크롤바가 안 먹는다").
        // toolbarH 를 더해 툴바 뒤까지 스크롤로 볼 수 있게 한다.
        contentContainerStyle={[wideContent, { padding: 16, paddingBottom: 24 + insets.bottom + toolbarH, gap: 14 }]}
        // ⚠️(2026-08-26) "handled"는 탭 대상이 표준 TextInput/Touchable 처럼 RN
        // 제스처 시스템에 "내가 처리했다"고 스스로 신호를 줄 때만 키보드를 안 닫는다.
        // 리치 에디터(EnrichedTextInput)는 Fabric 커스텀 네이티브 뷰라 이 신호를
        // 표준 방식대로 안 줘서, 제목 입력칸에서 바로 이어 리치 박스를 탭하면 첫
        // 탭은 "박스 바깥 탭"으로 처리돼 키보드가 닫히고 두 번째 탭에야 포커스가
        // 넘어갔다(오너 제보: "제목 입력하고 바로 내용 박스 누르면 키보드가 바로
        // 닫히고 한번 더 눌러야 올라온다"). "always"로 바꿔 탭 자체로는 절대 키보드를
        // 안 닫게 한다.
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="interactive"
        // richBoxTouching 설명은 위 state 선언부 참고 — 손가락이 리치 박스 안에 있는
        // 동안만 바깥 스크롤을 잠가서 안쪽 웹뷰 스크롤과 충돌하지 않게 한다.
        scrollEnabled={!richBoxTouching}
        // 커서와 키보드 사이에 둘 거리. 키보드 위에 도구줄이 얹혀 있으니 그 높이까지만
        // 비켜준다. 이보다 크게 잡으면 필요 없이 화면이 밀려 올라간다.
        bottomOffset={toolbarH + CARET_GAP}
      >
        {/* 닉네임 · 말머리. 닉네임은 MY에서 정한 공용 닉네임을 그대로 쓴다(여기선 수정 불가,
            2026-08-23 오너 지시 — 전 서비스 닉네임 통일). 바꾸려면 MY에서. */}
        <View style={styles.topRow}>
          <View style={styles.nickCol}>
            <Text style={styles.label}>닉네임</Text>
            <TouchableOpacity style={styles.nickReadonly} activeOpacity={0.7} onPress={() => router.push('/my')}>
              <Text style={styles.nickReadonlyText} numberOfLines={1}>{nickname || '미설정'}</Text>
              <Ionicons name="pencil" size={13} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {/* 말머리 — 항상 보이게(로딩 레이스로 사라지던 문제 수정 2026-08-24). 목록 비어도 '선택 안함'. */}
          <View style={styles.tagCol}>
            <Text style={styles.label}>말머리</Text>
            <TouchableOpacity style={styles.select} onPress={() => setTagPickerOpen(true)} activeOpacity={0.75}>
              <Text style={styles.selectText} numberOfLines={1}>{selectedTagLabel}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
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
          {richMode ? (
            // react-native-enriched-html(완전 네이티브 — 웹뷰 없음). 툴바는 키보드
            // 바로 위에 따로 고정한다(아래 KeyboardStickyView 참고, 오너 지시
            // 2026-08-25: "키보드 위 방식으로 하자").
            <View style={styles.richBox}>
              <BoardRichEditor
                ref={richRef}
                colors={colors}
                initialHTML={content}
                placeholder="내용을 입력하세요"
                onChangeText={setRichText}
                onReady={() => setRichReady(true)}
                onStateChange={setRichState}
                onUnavailable={fallbackToLegacy}
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
          <View style={{ marginTop: 8, gap: 8 }}>
            {/* 리치모드는 사진을 본문 안에 넣지 않으므로(위 insertRichMedia 참고), 여기서
                유튜브 링크와 같은 자리에 썸네일 갤러리로 보여준다. 단순모드는 이미
                BoardEditorInput 안에서 images 를 자체적으로 보여주니 또 넣지 않는다. */}
            {richMode && <BoardImageChips images={images} onRemove={editor.removeImage} />}
            <BoardLinkChips api={linksApi} links={links} />
          </View>
        </View>

        {/* 투표 — 신규글에만. 추가 버튼은 아래 첨부 툴바(사진·GIF·유튜브 옆)로 옮겼다
            (2026-08-24 오너 지시: "이미지·gif·유튜브 옆에"). 여기는 켰을 때 편집블록만. */}
        {!isEdit && poll && (
          <PollEditor draft={poll} onChange={setPoll} onRemove={() => setPoll(null)} />
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
      {!richMode && (
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
            onPress={() => linksApi.openAdd('youtube')}
            hitSlop={8}
          >
            <Ionicons name="logo-youtube" size={21} color={colors.textSecondary} />
            <Text style={styles.toolText}>유튜브</Text>
          </TouchableOpacity>

          {/* 인스타 링크 — 유튜브 옆(2026-08-24 오너 지시: "깜빡했었다"). 아이콘만(폭 절약,
              이 폴백 툴바는 리치에디터 감지 성공 후엔 사실상 안 쓰인다). */}
          <TouchableOpacity
            style={styles.tool}
            onPress={() => linksApi.openAdd('instagram')}
            hitSlop={8}
          >
            <Ionicons name="logo-instagram" size={21} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* 투표 — 신규글에만, 이미 추가했으면 다시 안 뜸(2026-08-24: 사진·GIF·유튜브 옆으로 이동). */}
          {!isEdit && !poll && (
            <TouchableOpacity style={styles.tool} onPress={() => setPoll(emptyPollDraft())} hitSlop={8}>
              <Ionicons name="bar-chart-outline" size={21} color={colors.textSecondary} />
              <Text style={styles.toolText}>투표</Text>
            </TouchableOpacity>
          )}

          {/* 동영상 — 숨김 기능(VIDEO_ENABLED=false). 압축→R2 업로드. 재빌드+승인 후 노출. */}
          {VIDEO_ENABLED && (
            <TouchableOpacity
              style={styles.tool}
              onPress={async () => {
                if (videoBusy) return
                setVideoBusy(true)
                const r = await pickCompressUploadVideo()
                setVideoBusy(false)
                if (r && 'error' in r) Alert.alert('알림', r.error)
                else if (r && 'url' in r) setVideos((v) => [...v, r.url])
              }}
              disabled={videoBusy}
              hitSlop={8}
            >
              <Ionicons name="videocam-outline" size={21} color={colors.textSecondary} />
              <Text style={styles.toolText}>{videoBusy ? '처리중' : '동영상'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardStickyView>
      )}

      {/* 리치모드 툴바 — 키보드 바로 위(오너 지시 2026-08-25: "키보드 위 방식으로
          하자"). KeyboardStickyView 가 안드에서 툴바를 통째로 숨기는 사고를 내서
          (위 kbHeightSV 주석 참고) 컴포넌트 대신 같은 저수준 reanimated 애니메이션
          값을 직접 받아 translateY 로 움직인다 — 키보드 열려있으면 그 높이만큼,
          닫혀있으면 안전영역(홈 인디케이터/3버튼)만큼만 띄운다. */}
      {richMode && richReady && (
        <Reanimated.View
          style={[styles.richToolbarFloat, richToolbarAnimatedStyle]}
          onLayout={(e) => setToolbarH(e.nativeEvent.layout.height)}
        >
          <BoardRichToolbar buttons={toolbarButtons} colors={colors} />
        </Reanimated.View>
      )}

      <LinkInputModal api={linksApi} />

      {/* 본문 텍스트에 거는 인라인 하이퍼링크 팝업(setLink) — 위 LinkInputModal(유튜브/
          인스타 썸네일용)과 별개, 말머리 선택 팝업과 같은 화면 가운데 카드 방식. */}
      <InlineLinkModal
        state={linkModal}
        colors={colors}
        onChangeText={(text) => setLinkModal((m) => ({ ...m, text, error: null }))}
        onChangeUrl={(url) => setLinkModal((m) => ({ ...m, url, error: null }))}
        onCancel={() => setLinkModal((m) => ({ ...m, visible: false }))}
        onConfirm={confirmInlineLink}
        onRemove={removeInlineLink}
      />

      {/* 사진·GIF 업로드 중 스피너 — 예전엔 툴바 아이콘만 흐리게 죽어서(비활성 표시)
          업로드 중인지 눈에 잘 안 띄었다(오너 지적: "이미지 첨부할때 바로바로
          첨부가 안되면 스피너를 보여주던가 해야할거잖아!"). 등록·수정 때 쓰던 것과
          같은 전체화면 스피너 규칙을 그대로 재사용. */}
      <LoadingOverlay
        visible={saving || loading || richUploading}
        message={richUploadProgress ? `${richUploadProgress.current}/${richUploadProgress.total}장 올리는 중` : undefined}
      />
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

/** 본문 인라인 하이퍼링크 팝업 — 표시 텍스트(선택 있으면 자동 채움) + URL 두 칸.
 *  누르는 순간 이미 링크인 범위였으면(wasActive) 삭제 버튼도 같이 보여준다. */
function InlineLinkModal({
  state, colors, onChangeText, onChangeUrl, onCancel, onConfirm, onRemove,
}: {
  state: { visible: boolean; text: string; url: string; error: string | null; wasActive: boolean }
  colors: AppColors
  onChangeText: (t: string) => void
  onChangeUrl: (u: string) => void
  onCancel: () => void
  onConfirm: () => void
  onRemove: () => void
}) {
  const styles = useMemo(() => makeLinkModalStyles(colors), [colors])
  return (
    <Modal visible={state.visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>링크 삽입</Text>
          <Text style={styles.label}>표시할 텍스트</Text>
          <TextInput
            style={styles.input}
            value={state.text}
            onChangeText={onChangeText}
            placeholder="링크에 표시될 글자"
            placeholderTextColor={colors.textTertiary}
          />
          <Text style={styles.label}>링크 주소</Text>
          <TextInput
            style={styles.input}
            value={state.url}
            onChangeText={onChangeUrl}
            placeholder="example.com"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {!!state.error && <Text style={styles.error}>{state.error}</Text>}
          <View style={styles.btnRow}>
            {state.wasActive && (
              <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={onRemove} activeOpacity={0.75}>
                <Text style={[styles.btnText, styles.btnDangerText]}>링크 삭제</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={onCancel} activeOpacity={0.75}>
              <Text style={styles.btnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onConfirm} activeOpacity={0.85}>
              <Text style={[styles.btnText, styles.btnTextPrimary]}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeLinkModalStyles(colors: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: {
      width: '100%', maxWidth: 360, borderRadius: 16, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.border, padding: 16,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
      elevation: 12,
    },
    title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
    label: { fontSize: 12, color: colors.textSecondary, marginBottom: 5 },
    input: {
      backgroundColor: colors.surfaceHigh, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5, color: colors.textPrimary, marginBottom: 12,
    },
    error: { fontSize: 12, color: '#ff5f5f', marginTop: -6, marginBottom: 10 },
    btnRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
    btn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center', backgroundColor: colors.surfaceHigh },
    btnPrimary: { backgroundColor: colors.primary },
    btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#ff5f5f' },
    btnText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    btnTextPrimary: { color: '#fff' },
    btnDangerText: { color: '#ff5f5f' },
  })
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
    // 닉네임 읽기전용(MY 공용) — 입력칸과 같은 높이·테두리, 연필로 MY 이동 암시.
    nickReadonly: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceHigh, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
    nickReadonlyText: { flex: 1, fontSize: 15, color: colors.textPrimary, fontWeight: '600' },
    hint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 5 },
    // 리치에디터 박스 — 본문 입력칸과 같은 테두리. 툴바가 이제 박스 밖(키보드 위)에
    // 있어서 박스 안엔 순수 텍스트 입력만 있다 — 예전 300 은 안에 툴바(44)까지 넣고
    // 잡은 값이라 지금은 과하다. react-native-enriched-html 의 scrollEnabled=false
    // 는 tentap dynamicHeight(웹뷰 높이 자기보고, 세 번 다르게 실패)와 달리 진짜
    // 네이티브 텍스트 레이아웃이라 최대높이 없이 내용만큼 그대로 늘어나게 둔다 —
    // 실기기로 직접 늘어나는지 확인 후 문제 있으면 다시 잡는다.
    // 오너 지시(2026-08-26): 입력박스를 더 키움. 밑에 있는 "욕설·비방…" 안내문이 스크롤
    // 해야 보이게 되더라도 상관없다고 확인받음 — 항상 한 화면에 다 보여야 하는 제약이
    // 아니다.
    richBox: { minHeight: 300, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.background },
    // 리치 툴바를 화면에 직접 띄우는 자리 — KeyboardStickyView 대신 RN Keyboard
    // 이벤트로 계산한 bottom 값을 그대로 쓴다(위 kbHeight 주석 참고).
    // bottom:0 고정 + translateY 애니메이션으로 위치 이동(위 richToolbarAnimatedStyle 참고) —
    // 예전처럼 bottom 값 자체를 JS state 로 매 프레임 바꾸면 리렌더가 껴서 한 박자 늦는다.
    richToolbarFloat: { position: 'absolute', left: 0, right: 0, bottom: 0 },
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
