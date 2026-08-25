import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, Modal, Pressable, ScrollView, Image } from 'react-native'
// 커서가 키보드에 가릴 때만, 가린 만큼만 올려주는 컴포넌트.
// RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서 동작하지 않는다(react-native#16826).
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import LoadingOverlay from '@/components/LoadingOverlay'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { createPost, updatePost, getPostForEdit } from '@/lib/board'
import { useBoardTags } from '@/hooks/useBoard'
import { useBoardEditor, BoardEditorInput, useBoardLinks, BoardLinkChips, LinkInputModal } from '@/components/BoardEditor'
import { youtubeThumbnail } from '@/lib/youtube'
import BoardRichEditor, { type RichEditorHandle } from '@/components/BoardRichEditor'
import BoardRichToolbar from '@/components/BoardRichToolbar'
import { DEFAULT_TOOLBAR_ITEMS, Images, type ToolbarItem } from '@10play/tentap-editor'
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
  // 유튜브·인스타 링크 추가 시 본문 안에도 넣는다(오너 지적: "첨부 컨텐츠들은 모두 본문
  // 내부에 넣게 하라고!!" — 사진은 안에, 링크는 밖(첨부 갤러리)에만 들어가서 자리가
  // 갈렸었다). 첨부 갤러리 자체는 유지 — 상세페이지 재생 썸네일에 필요.
  // ⚠️(2026-08-25) 처음엔 링크 텍스트(주소 문자열)만 넣었는데, 오너가 "저게 썸네일
  // 유튜브라고 생각하냐!!"라고 맞게 지적 — 주소만 있으면 유튜브인지 알 수가 없다.
  // 조사 결과(Discourse Onebox, Discord/Slack 링크 언퍼얼링) 유튜브는 실제 썸네일
  // 이미지를 본문에 넣는 게 실제 게시판·포럼들의 표준 방식이라, 사진 삽입과 같은
  // insertImage 커맨드로 유튜브 공개 썸네일(img.youtube.com) 을 이미지로 넣고 링크
  // 텍스트도 이어 붙인다. 인스타는 유튜브처럼 공개 썸네일 URL 규칙이 없어서(oEmbed API
  // 인증이 필요, 이 앱 구조로는 무리) 조사에서도 "실제 미리보기 없이 아이콘/링크만"이
  // 실제 플랫폼들의 표준 폴백이라고 확인 — 링크 텍스트까지만 넣는다.
  const linksApi = useBoardLinks(links, setLinks, (url, mode) => {
    if (mode === 'youtube') {
      const thumb = youtubeThumbnail(url)
      if (thumb) richRef.current?.insertImage(thumb)
    }
    richRef.current?.insertLinkText(url)
  })
  const [richText, setRichText] = useState('')
  // tentap editor 인스턴스 — 입력칸 상단 고정 툴바(BoardRichToolbar)에 넘긴다.
  const [richEditor, setRichEditor] = useState<unknown>(null)
  // 리치에디터(tentap/webview) 활성(2026-08-25). 예전엔 "Maximum update depth exceeded"
  // 무한 렌더 루프 때문에 자바스크립트 스레드가 막혀 화면 전체 터치가 먹통이 됐다
  // (BoardRichEditorImpl.tsx 참고 — useEditorBridge 가 돌려주는 editor 객체가 렌더마다
  // 새 참조라 onEditorReady 이펙트가 계속 재실행되며 부모 state를 무한히 갱신했다).
  // 시뮬레이터로 직접 재현해서 실제 에러 로그로 원인을 확인하고 고쳤다.
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
  const insertRichMedia = async (mode: 'photo' | 'gif') => {
    if (richUploading) return
    setRichUploading(true)
    try {
      // 사진은 한 번에 여러 장 골라 순서대로 넣는다(오너 지적: "이미지 첨부할때 왜
      // 하나씩 밖에 안되는데!!" — 기존 첨부 방식(boardImage.ts pickAndUploadMany)을
      // 그대로 재사용). 움짤은 원래대로 한 장씩(용량 제한이 파일당이라 다르게 다룸).
      if (mode === 'photo') {
        const r = await pickAndUploadMany(MAX_IMAGES, (current, total) => setRichUploadProgress({ current, total }))
        if (r) {
          for (const url of r.urls) await richRef.current?.insertImage(url)
          if (r.error) Alert.alert('알림', r.error)
          else if (r.skipped > 0) Alert.alert('알림', `한 번에 최대 ${MAX_IMAGES}장까지만 넣을 수 있어서 ${r.skipped}장은 빠졌어요.`)
        }
      } else {
        const r = await pickAndUpload(mode)
        if (r && 'url' in r) await richRef.current?.insertImage(r.url)
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

  // 리치 툴바 — 한 줄로 통합(오너 지시 2026-08-25: "에디터 두번째줄에 있는 것들 모두
  // 없애고, 글자색/배경색/되돌리기. 이거 3개만 살리자. 그래서 전체 에디터 도구를
  // 한줄로 맞추자"). 링크·헤딩·목록·인용·체크리스트는 뺀다(하이퍼링크는 자동
  // 감지(autolink)로 대체 — LinkBridge 기본 설정에 이미 있음). GIF·인스타·투표는
  // 코드는 남기고 목록에서만 뺐다("일단 숨겨서 안보이게 해놔라. 나중에 필요하면
  // 추가할 수 있으니") — 필요해지면 아래 배열에 다시 넣기만 하면 된다.
  const pickDefaultItem = useCallback((img: unknown): ToolbarItem => {
    const found = DEFAULT_TOOLBAR_ITEMS.find((item) => item.image({} as never) === img)
    if (!found) throw new Error('tentap 기본 툴바 아이템을 못 찾음')
    return found
  }, [])

  // 글자색·배경색 — 엔진(ColorBridge·HighlightBridge)은 이미 붙어있었는데 버튼이 없었다
  // (오너 지적: "글자색. 글자배경색. 이런 기본적인 것들이 하나도 없잖아"). 탭하면 이 줄이
  // 프리셋 색상 스와치 줄로 바뀌는 방식 — 헤딩 버튼이 서브메뉴로 바뀌는 것과 같은 패턴.
  const [colorPicker, setColorPicker] = useState<'text' | 'highlight' | null>(null)
  const TEXT_COLORS = ['#1F2937', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6']
  const HIGHLIGHT_COLORS = ['#FEF08A', '#FBCFE8', '#BBF7D0', '#BFDBFE', '#FED7AA', '#E9D5FF']

  const richToolbarItems: ToolbarItem[] = useMemo(() => [
    { onPress: () => () => insertRichMedia('photo'), active: () => false, disabled: () => richUploading, image: () => require('@/assets/rich-toolbar/photo.png') },
    // GIF·인스타·투표 — 일단 숨김(오너 지시). 다시 켜려면 아래 세 줄 주석만 풀면 된다.
    // { onPress: () => () => insertRichMedia('gif'), active: () => false, disabled: () => richUploading, image: () => require('@/assets/rich-toolbar/gif.png') },
    { onPress: () => () => linksApi.openAdd('youtube'), active: () => false, disabled: () => false, image: () => require('@/assets/rich-toolbar/youtube.png') },
    // { onPress: () => () => linksApi.openAdd('instagram'), active: () => false, disabled: () => false, image: () => require('@/assets/rich-toolbar/instagram.png') },
    // ...(!isEdit && !poll ? [{ onPress: () => () => setPoll(emptyPollDraft()), active: () => false, disabled: () => false, image: () => require('@/assets/rich-toolbar/poll.png') }] : []),
    pickDefaultItem(Images.bold),
    pickDefaultItem(Images.italic),
    pickDefaultItem(Images.underline),
    // ⚠️ 글자색 아이콘은 처음에 text-outline(Ionicons) 으로 만들었더니 헤딩(Images.Aa)
    // 아이콘이랑 똑같이 "Aa" 모양으로 보여서 헷갈렸다(직접 캡처해서 확인) — tentap 에 이미
    // 있는 팔레트 아이콘(Images.palette, 기본 툴바엔 안 쓰이던 것)으로 바꿔 구분되게 했다.
    { onPress: () => () => setColorPicker('text'), active: () => false, disabled: () => false, image: () => Images.palette },
    { onPress: () => () => setColorPicker('highlight'), active: () => false, disabled: () => false, image: () => require('@/assets/rich-toolbar/highlight_color.png') },
    pickDefaultItem(Images.undo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [richUploading])
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
  const bodyFilled = richMode ? richText.trim().length > 0 : content.trim().length > 0
  const canSave = nickname.trim().length >= 2 && title.trim().length > 0 && bodyFilled && !needsAgreement

  // 쓰던 게 있으면 닫기 전에 물어본다
  const dirty = title.trim().length > 0 || bodyFilled || contentBelow.trim().length > 0 || images.length > 0 || links.length > 0 || poll !== null || videos.length > 0
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
    if (richMode) {
      bodyContent = (await richRef.current?.getHTML()) ?? ''
      bodyImages = extractImageUrls(bodyContent)
      bodyBelow = ''
    }
    const r = isEdit
      ? await updatePost({ postId: id!, title: title.trim(), content: bodyContent, contentBelow: bodyBelow, imageUrls: bodyImages, linkUrls: links, tagId })
      : await createPost({ nickname: nickname.trim(), title: title.trim(), content: bodyContent, contentBelow: bodyBelow, imageUrls: bodyImages, linkUrls: links, videoUrls: videos, tagId })
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
        // 안드로이드 3버튼 내비게이션 바가 화면 맨 밑을 가려서 약관 동의 체크박스가
        // 잘렸다(오너 지적: "안드폰 3버튼 감안해서 맨 밑에 약관 동의 체크박스 부분
        // 높이 맞춰라. 밑에 잘렸다"). insets.bottom 을 더해서 그 높이만큼 여유를 둔다.
        contentContainerStyle={[wideContent, { padding: 16, paddingBottom: 24 + insets.bottom, gap: 14 }]}
        keyboardShouldPersistTaps="handled"
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
            // 재빌드 후: 리치에디터(tentap). 본문 안에 서식·이미지 인라인. 툴바는 입력칸
            // 상단에 고정(2026-08-25 — 키보드 위 KeyboardStickyView 방식은 폐기).
            <View
              style={styles.richBox}
              onTouchStart={() => setRichBoxTouching(true)}
              onTouchEnd={() => setRichBoxTouching(false)}
              onTouchCancel={() => setRichBoxTouching(false)}
            >
              {/* tentap 기본 테마의 toolbarBody 가 flex:1 이라 theme 오버라이드(flex:0)만으로는
                  이 컬럼 안에서 다른 flex:1 형제(에디터 본문)와 남는 높이를 나눠 가져가버렸다
                  (오너 지적: "3줄이 입력박스 전체에 걸쳐서 밑으로 내려온다"). 줄마다 높이를
                  44 로 못박은 바깥 View 로 한 번 더 감싸서 안쪽 FlatList 가 얼마나 늘어나려
                  하든 딱 44 안에서만 채워지게 강제로 가둔다. */}
              {!!richEditor && (
                colorPicker ? (
                  <View style={[styles.richToolbarRow, styles.richSwatchRow]}>
                    <TouchableOpacity style={styles.richSwatchBackBtn} onPress={() => setColorPicker(null)} hitSlop={6}>
                      <Image source={require('@/assets/rich-toolbar/picker_back.png')} style={[styles.richSwatchBackIcon, { tintColor: colors.textSecondary }]} />
                    </TouchableOpacity>
                    {(colorPicker === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS).map((hex) => (
                      <TouchableOpacity
                        key={hex}
                        style={styles.richSwatchBtn}
                        hitSlop={4}
                        onPress={() => {
                          // ⚠️(2026-08-25) HighlightBridge.setHighlight 는 문자열(color: string)을
                          // 받는데, 내부에서 이미 { color } 로 감싸서 보낸다(highlight.ts 참고) —
                          // 여기서 또 { color: hex } 로 한 번 더 감싸서 넘겼더니 Tiptap 쪽에
                          // 색상 값이 깨져서 항상 기본값(노란색)만 적용됐다(오너 지적: "글자
                          // 배경색은 뭘 골라도 노란색만 적용되고"). 그냥 문자열로 넘겨야 한다.
                          const e = richEditor as { setColor?: (c: string) => void; setHighlight?: (c: string) => void }
                          if (colorPicker === 'text') e.setColor?.(hex)
                          else e.setHighlight?.(hex)
                          setColorPicker(null)
                        }}
                      >
                        <View style={[styles.richSwatchDot, { backgroundColor: hex }]} />
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      style={styles.richSwatchBtn}
                      hitSlop={4}
                      onPress={() => {
                        const e = richEditor as { unsetColor?: () => void; unsetHighlight?: () => void }
                        if (colorPicker === 'text') e.unsetColor?.()
                        else e.unsetHighlight?.()
                        setColorPicker(null)
                      }}
                    >
                      <View style={styles.richSwatchNone}>
                        <Ionicons name="close" size={14} color={colors.textSecondary} />
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.richToolbarRow}>
                    <BoardRichToolbar editor={richEditor} items={richToolbarItems} />
                  </View>
                )
              )}
              <BoardRichEditor
                ref={richRef}
                colors={colors}
                initialHTML={content}
                placeholder="내용을 입력하세요"
                onChangeText={setRichText}
                onEditorReady={setRichEditor}
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
          <View style={{ marginTop: 8 }}>
            <BoardLinkChips api={linksApi} links={links} />
          </View>

          {/* 첨부가 있을 때만 아래에 '이어 쓰는 본문' 입력칸(기존 모드 전용). 스타일은 윗칸(본문)과 동일.
              첨부를 다 빼면 칸은 사라지되 입력한 내용은 state 에 남아(hasAttach 로 렌더만
              감춤) 다시 첨부하면 복구된다(오너 결정 2026-08-21). */}
          {!richMode && hasAttach && (
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

      <LinkInputModal api={linksApi} />

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
    // 아랫글 입력칸 — 본문(BoardEditor.input)과 완전히 같은 값(오너: 위아래 똑같이).
    belowInput: {
      backgroundColor: colors.surfaceHigh, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, lineHeight: 22,
      color: colors.textPrimary,
      borderWidth: 1, borderColor: colors.border, minHeight: 220,
    },
    belowHint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 6, lineHeight: 17 },
    // 리치에디터 박스(재빌드 후) — 본문 입력칸과 같은 테두리, 에디터+툴바 담김.
    // 툴바가 입력칸 상단에 고정으로 들어가며(최대 3줄 × 44pt ≈ 132pt) 그만큼 타이핑
    // 공간이 줄어드니, 박스 자체를 예전보다 키워서 하단에 빈 공간 없이 꽉 차게 한다
    // (오너 지시 2026-08-25).
    // 2줄(오너 지시 2026-08-25: "2줄로 만들어!")로 줄어서 툴바가 88 만 차지 — 그만큼
    // 박스는 줄여도 타이핑 공간은 3줄 때(520)와 비슷하게 유지된다.
    // ⚠️(2026-08-25) 근본 원인 확정 — 웹뷰(에디터 본문)는 RN 쪽에 자기 실제 문서 높이를
    // 보고하지 않는 한 부모가 flex 로 나눠준 높이에서 안 늘어난다. 그 실제 높이를 RN 에
    // 보고하게 하는 tentap 공식 기능(dynamicHeight)을 두 번 시도했는데 한 번은 에디터가
    // 안 보이는 사고, 한 번은 이미지 삽입 자체가 무한 로딩에 빠지는 사고가 나서 둘 다
    // 원복했다(오너: "스크롤바 얘기했다고 디자인 다 깨뜨리면 집어치워라" — 검증 안 된
    // 걸 억지로 밀어넣지 않는다). overflow 를 열어보는 것도 시도했지만 효과 없음을
    // 직접 재현해서 확인(스크롤이 특정 지점에서 그대로 멈춤). 페이지 전체 스크롤 하나로
    // 처리하는 방식은 이 프로젝트 환경에서 안전하게 구현할 방법을 아직 못 찾았다 —
    // 그래서 최대 높이를 정하고 그 안에서는 박스 자체가 확실하게 동작하는 내부 스크롤을
    // 쓰기로 한다(페이지 전체 스크롤 방식이 두 번 다 실패했으니, 최소한 확실히 되는
    // 쪽을 우선한다). maxHeight 600 — 화면 대부분을 채우면서도 등록 버튼 등 다른
    // 요소가 완전히 밀려나지 않을 정도.
    richBox: { minHeight: 480, maxHeight: 600, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.background },
    // 줄마다 44 로 고정 — tentap FlatList 자체 flex 를 못 믿으니 바깥에서 한 번 더 가둔다.
    richToolbarRow: { height: 44, overflow: 'hidden' },
    // 글자색·배경색 프리셋 스와치 줄 — 2번째 줄이 탭하면 이 모습으로 바뀐다.
    richSwatchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 10, backgroundColor: colors.surfaceHigh, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderTopColor: colors.divider, borderBottomColor: colors.divider },
    richSwatchBackBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    richSwatchBackIcon: { width: 18, height: 18 },
    richSwatchBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
    richSwatchDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.divider },
    richSwatchNone: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.divider, alignItems: 'center', justifyContent: 'center' },
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
