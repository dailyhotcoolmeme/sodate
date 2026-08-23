import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, RefreshControl, Modal, Pressable, Dimensions,
} from 'react-native'
// 키보드가 올라오면 '내용 영역 자체가 줄어든다'. 애플이 keyboard layout guide 로
// 설명하는 방식이다 — 보던 자리는 그대로 있고 목록 끝까지 접근할 수 있다.
// 입력줄만 띄우고 목록을 그대로 두면 아래쪽 댓글이 덮여 손이 닿지 않는다
// (2026-08-01 오너 지적 후 조사). RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서
// 동작하지 않으므로(react-native#16826) 이 라이브러리 것을 쓴다.
import { KeyboardAvoidingView, KeyboardController, KeyboardEvents, useKeyboardState } from 'react-native-keyboard-controller'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import ReportSheet from '@/components/ReportSheet'
import LoadingOverlay from '@/components/LoadingOverlay'
import AuthorMenu, { AUTHOR_MENU_ENABLED, type AuthorMenuTarget } from '@/components/AuthorMenu'
import PostHtmlView from '@/components/PostHtmlView'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useBoardPost } from '@/hooks/useBoard'
import {
  vote, deletePost, createComment, updateComment, deleteComment, markViewed, report,
  displayViewCount, toggleScrap,
} from '@/lib/board'
import { getLastNickname } from '@/lib/reviewIdentity'
import { blockAuthor, markCommentsSeen, getMyPostIds, markPostRead, isScrapped } from '@/lib/boardIdentity'
import { NEW_TABS_ENABLED } from '@/constants/features'
import { wideContent } from '@/constants/layout'
import { openOutlink } from '@/lib/outlink'
import { youtubeThumbnail } from '@/lib/youtube'
import type { BoardComment } from '@/lib/board'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

/** 댓글 입력칸과 등록 버튼의 한 줄 높이 */
const COMPOSER_H = 38

// 가로로 아주 긴 파노라마만 눌러준다.
//
// ⚠️ 세로 하한(IMAGE_MIN_RATIO 0.55)은 없앴다(오너 지시 2026-08-21).
//    화면을 너무 차지하지 말라고 넣었던 값인데, contentFit="cover" 와 같이 쓰여서
//    **하한을 넘는 세로 사진을 잘라내고 있었다**. 긴 캡처는 대개 글자가 들어 있어
//    잘리면 내용 자체를 못 본다(1080x3000 이면 위아래 34%, 1080x5000 이면 60% 손실).
//    이제 세로로 긴 사진은 긴 그대로 전부 보여준다 — 스크롤이 길어지는 건 감수한다.
const IMAGE_MAX_RATIO = 2.2   // 가로로 아주 긴 사진의 상한

/**
 * 게시글 첨부 사진. 예전엔 높이 220 고정 + contentFit="cover" 라 세로로 긴 사진(휴대폰
 * 세로사진 대부분)이 위아래로 심하게 잘려 보였다(2026-08-13 오너 지적). 로드되면 실제
 * 가로세로 비율을 읽어 그 비율대로 높이를 잡는다 — 안 잘리고 전체가 다 보인다.
 */
function PostImage({ uri, style }: { uri: string; style: any }) {
  const [ratio, setRatio] = useState<number | null>(null)
  return (
    <Image
      source={{ uri }}
      style={[style, ratio != null && { height: undefined, aspectRatio: ratio }]}
      contentFit="cover"
      onLoad={(e) => {
        const { width, height } = e.source
        if (width > 0 && height > 0) {
          setRatio(Math.min(IMAGE_MAX_RATIO, width / height))
        }
      }}
    />
  )
}

// 화면 밖 이미지를 미리 불러올 여유 거리 — 한 화면 높이 정도 앞서 로드해서
// 스크롤이 닿기 전에 이미 준비돼 있게 한다.
const IMAGE_LAZY_BUFFER = 600

/**
 * 사진을 한꺼번에 다 열지 않고, 화면(뷰포트) 가까이 왔을 때만 실제로 불러온다
 * (2026-08-13 오너 지시 — 갯수 제한을 10개로 늘리면서, 어차피 스크롤해야 보이는
 * 아래쪽 사진들까지 진입 즉시 전부 내려받을 필요는 없다는 판단).
 *
 * RN에는 IntersectionObserver가 없어서 `measureInWindow`로 이 뷰의 현재 화면상
 * 위치를 직접 재는 방식으로 흉내낸다 — 스크롤할 때마다(위 [id].tsx의 onScroll)
 * scrollTick이 바뀌면 다시 재보고, 화면 버퍼 안에 들어오면 그때 실제 <PostImage>를
 * 마운트한다. 한 번 로드된 뒤에는 다시 안 가린다(스크롤 왔다갔다해도 재요청 없음).
 */
function LazyPostImage({ uri, style, scrollTick }: { uri: string; style: any; scrollTick: number }) {
  const wrapRef = useRef<any>(null)
  const [near, setNear] = useState(false)

  const check = useCallback(() => {
    if (near) return
    wrapRef.current?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
      const screenH = Dimensions.get('window').height
      if (h > 0 && y < screenH + IMAGE_LAZY_BUFFER && y + h > -IMAGE_LAZY_BUFFER) setNear(true)
    })
  }, [near])

  useEffect(check, [scrollTick, check])

  if (!near) {
    return <View ref={wrapRef} style={style} onLayout={check} />
  }
  return <PostImage uri={uri} style={style} />
}

/** 글 상세 — 추천·비추, 댓글(대댓글 한 단계), 내 글이면 수정·삭제. */
export default function BoardPostScreen() {
  const { id, commentId } = useLocalSearchParams<{ id: string; commentId?: string }>()
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const { post, postBlocked, comments, myVote, isMine, myCommentIds, loading, error, refetch } = useBoardPost(id)

  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)

  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  const [voting, setVoting] = useState(false)
  // 스크랩(NEW_TABS_ENABLED 전환 전까지 버튼은 숨김). 로컬 캐시로 즉시 채워진 상태 표시.
  const [scrapOn, setScrapOn] = useState(false)
  const [scrapping, setScrapping] = useState(false)
  const [nickname, setNickname] = useState('')
  const [draft, setDraft] = useState('')
  // 비밀 댓글 — 동행 구할 때 연락처를 주고받아야 해서 넣었다(2026-08-12 오너 지시).
  const [secret, setSecret] = useState(false)
  const [editing, setEditing] = useState<BoardComment | null>(null)
  const [sending, setSending] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment' | 'content'; id: string } | null>(null)
  const keyboardShown = useKeyboardState((k) => k.isVisible)
  const scrollY = useRef(0)
  const [composing, setComposing] = useState(false)   // 입력칸을 만졌는가(닉네임 줄 펼침)
  // 댓글 입력칸 높이를 직접 정한다. `minHeight` 는 최솟값일 뿐이라 iOS 는 내부
  // 여백 때문에 그보다 커져서 등록 버튼(정확히 COMPOSER_H)과 높이가 안 맞았다
  // (2026-08-01 오너 지적). 네이티브가 알아서 정하게 두지 않고 숫자로 고정한다.
  const [commentInputH, setCommentInputH] = useState(COMPOSER_H)
  const scrollRef = useRef<ScrollView>(null)
  // 댓글마다 화면에서의 세로 위치. 방금 쓰거나 수정한 댓글로 옮겨갈 때 쓴다.
  const commentY = useRef<Record<string, number>>({})
  const [scrollToId, setScrollToId] = useState<string | null>(null)
  // 답글은 팝업으로 쓴다 — 목록을 스크롤해 대상 댓글을 입력줄 위로 맞추는 방식은
  // 댓글이 짧은 글에서 계속 어긋났다(빈 공간이 남거나 엉뚱한 자리에서 멈춤,
  // 2026-08-01). mlbpark 등 실제 커뮤니티가 쓰는 방식대로 팝업 안에 "OOO님에게
  // 답글" 표시 + 입력칸을 두면 목록을 움직일 필요 자체가 없다(오너 지시).
  // 글 삭제·차단·댓글 삭제 — 규칙(등록·수정·삭제는 전부 화면 전체 중앙 스피너)에서
  // 빠져 있던 세 곳(2026-08-14 오너 지적 — 댓글 등록 스피너가 버튼 근처처럼 보인다고
  // 전수조사 요청, 조사해보니 이 셋은 로딩 표시 자체가 아예 없었다).
  const [deletingPost, setDeletingPost] = useState(false)
  const [blockingAuthor, setBlockingAuthor] = useState(false)
  // 닉네임을 누르면 **바로 이동하지 않고** 그 자리에 작은 메뉴를 띄운다
  // (게시글 보기 / 댓글 보기). 2026-08-19 오너 지적 — 글을 읽다 닉네임에 손이
  // 스치기만 해도 화면이 통째로 바뀌면 안 되고, 무엇을 보러 갈지 고를 수 있어야 한다.
  // 묶는 기준은 닉네임이 아니라 owner_token(기기)이다 — 같은 닉네임을 여러 사람이
  // 쓰고 있어서 닉네임으로 묶으면 남의 글이 섞인다(hooks/useBoard.ts 의 실측 참고).
  const [authorMenu, setAuthorMenu] = useState<AuthorMenuTarget | null>(null)
  const openAuthor = useCallback((ownerToken: string, nick: string, x: number, y: number) => {
    setAuthorMenu({ token: ownerToken, nickname: nick, x, y })
  }, [])
  const [deletingComment, setDeletingComment] = useState(false)
  const [replyModal, setReplyModal] = useState<BoardComment | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyNickname, setReplyNickname] = useState('')
  const [replySecret, setReplySecret] = useState(false)
  const [replySending, setReplySending] = useState(false)
  // 목록(ScrollView) 실제 내용 길이·창 높이. 얼마나 밀 수 있는지, 밀 필요가
  // 있기는 한지 계산하는 데 쓴다. 억지로 여백을 만들어 늘리지 않는다 — 댓글이
  // 하나뿐인 글처럼 가릴 내용 자체가 없으면 밀 필요도 없다(2026-08-01 실측).
  const contentHeightRef = useRef(0)
  const viewportHeightRef = useRef(0)
  // 사진 지연 로드(LazyPostImage)가 다시 재볼 시점을 알리는 값 — 스크롤마다 매번
  // state를 갱신하면 리렌더가 너무 잦아지니 150ms 간격으로만 올린다.
  const [scrollTick, setScrollTick] = useState(0)
  const lastTickAtRef = useRef(0)

  /**
   * 댓글 입력줄을 누르면 가장 마지막 댓글이 보이도록 목록을 밀어 올린다.
   * 이미 다 보이면(내용이 짧은 글) 밀지 않는다 — 밀어 봐야 그 아래는 빈 공간이다
   * (2026-08-01 오너 지시).
   *
   * `keyboardDidShow`(키보드가 다 올라온 "뒤"에 온다)가 아니라 `keyboardWillShow`
   * (키보드가 올라오기 "직전"에 온다)를 쓴다. Did-show 를 쓰면 키보드가 다 올라오고
   * 나서야 화면이 뒤늦게 움직여서 두 동작이 따로 노는 것처럼 보인다(오너 지적).
   */
  const scrollForKeyboard = useCallback(() => {
    // 키보드가 다 올라온 뒤 실제로 보일 수 있는 최대 스크롤 값(지금 잰 창 높이 기준).
    const maxScroll = Math.max(0, contentHeightRef.current - viewportHeightRef.current)
    if (maxScroll > scrollY.current) {
      scrollRef.current?.scrollTo({ y: maxScroll, animated: true })
    }
  }, [])

  useEffect(() => {
    const willShow = KeyboardEvents.addListener('keyboardWillShow', (e) => {
      scrollForKeyboard()
      // 창 높이(viewportHeightRef)가 키보드만큼 줄어드는 layout 반영이 이 시점엔
      // 아직 안 끝났을 수 있다 — 키보드 애니메이션이 실제로 끝나는 시점(e.duration)에
      // 맞춰 반영된 값으로 한 번 더 계산해서 보정한다.
      setTimeout(scrollForKeyboard, e.duration || 250)
    })
    return () => willShow.remove()
  }, [scrollForKeyboard])

  // 목록 화면 새 댓글 띠에서 넘어올 때 — 그 댓글 위치로 바로 이동한다(2026-08-12).
  useEffect(() => { if (commentId) setScrollToId(commentId) }, [commentId])

  /**
   * 내 글을 열어서 댓글을 봤으면 그것으로 '읽음'이다.
   *
   * 예전에는 목록 상단 배너를 눌렀을 때만 읽음 처리해서, 목록에서 글 제목을 눌러
   * 들어가 다 읽고 나와도 배너가 "새로운 댓글 +1개" 그대로 남아 있었다. 실제로는
   * 대부분 제목을 눌러 들어가므로 배너가 영영 안 사라졌다(2026-08-13 감사).
   */
  useEffect(() => {
    if (!id || !comments.length) return
    let alive = true
    ;(async () => {
      const myPosts = await getMyPostIds()
      if (!alive || !myPosts.includes(id)) return   // 내 글일 때만 셈에 들어간다
      await markCommentsSeen(comments.map((c) => c.id))
    })()
    return () => { alive = false }
  }, [id, comments])

  // 방금 쓰거나 수정한 댓글이 화면 밖에 있으면 그 자리로 옮겨간다(등록 후).
  // 목록이 새로 그려진 뒤에 옮겨간다. 위치를 아직 모르면 다음 그리기까지 기다린다.
  // 다른 화면에서 막 넘어온 경우(commentId 딥링크)는 댓글 목록이 이제 막 그려지는
  // 중이라 onLayout 이 늦게 잡힐 수 있어 한 번 더 재시도한다.
  useEffect(() => {
    if (!scrollToId) return
    const tryScroll = () => {
      const y = commentY.current[scrollToId]
      if (y == null) return false
      const maxScroll = Math.max(0, contentHeightRef.current - viewportHeightRef.current)
      scrollRef.current?.scrollTo({ y: Math.min(Math.max(0, y - 80), maxScroll), animated: true })
      return true
    }
    if (tryScroll()) { setScrollToId(null); return }
    const t = setTimeout(() => { if (tryScroll()) setScrollToId(null) }, 250)
    return () => clearTimeout(t)
  }, [scrollToId, comments])

  // 닉네임은 가장 최근에 쓴 값을 물고 간다(후기 작성과 동일). 여기서 바꾸면
  // 그 값이 다음부터 기본값이 된다 — 저장은 lib/board.ts 에서 한다.
  useEffect(() => { getLastNickname().then((n) => n && setNickname(n)) }, [])
  // 조회수는 화면에 감춰뒀지만 값은 쌓아둔다(나중에 켜면 그때까지 숫자가 그대로).
  useEffect(() => { if (id) markViewed(id) }, [id])
  // 목록에서 읽은 글을 연하게 표시하기 위한 기기 저장(2026-08-13 오너 지시).
  useEffect(() => { if (id) markPostRead(id) }, [id])
  useFocusEffect(useCallback(() => { refetch() }, [refetch]))


  const handleVote = async (value: 1 | -1) => {
    if (voting) return
    setVoting(true)
    const r = await vote(id, value)
    setVoting(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    refetch()
  }

  // 스크랩 초기 상태(로컬 캐시). NEW_TABS 전환 전엔 버튼이 안 보이므로 굳이 서버 조회 안 함.
  useEffect(() => { if (NEW_TABS_ENABLED) isScrapped(id).then(setScrapOn) }, [id])

  const handleScrap = async () => {
    if (scrapping) return
    setScrapping(true)
    const prev = scrapOn
    setScrapOn(!prev)                    // 낙관적 갱신 — 바로 채워진 북마크로 보인다
    const r = await toggleScrap(id)
    setScrapping(false)
    if ('error' in r) { setScrapOn(prev); Alert.alert('알림', r.error); return }
    setScrapOn(r.scrapped)
  }

  const handleDelete = () => {
    Alert.alert('글 삭제', '이 글을 삭제할까요? 댓글도 함께 사라집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          setDeletingPost(true)
          const r = await deletePost(id)
          setDeletingPost(false)
          if ('error' in r) { Alert.alert('알림', r.error); return }
          router.back()
        },
      },
    ])
  }

  // 작성자 차단(애플 1.2 요건) — 이 기기에서만 해당 작성자의 글·댓글을 가린다. 차단 자체가
  // 운영자 신고로도 접수돼야 한다는 게 애플의 명시 요구라(2026-08-04 반려 재확인,
  // "blocking should also notify the developer"), 신고와 분리해뒀던 걸 여기서 합친다.
  const handleBlockAuthor = (
    targetNickname: string, ownerToken: string, andGoBack: boolean,
    targetType: 'post' | 'comment', targetId: string
  ) => {
    Alert.alert(
      `'${targetNickname}' 차단`,
      '이 작성자의 글·댓글이 이 기기에서 더 이상 보이지 않습니다. 운영자에게도 신고로 접수됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '차단', style: 'destructive',
          onPress: async () => {
            setBlockingAuthor(true)
            await blockAuthor(ownerToken, targetNickname)
            await report(targetType, targetId, '사용자 차단')
            setBlockingAuthor(false)
            if (andGoBack) router.back()
            else refetch()
          },
        },
      ]
    )
  }

  const submitComment = async () => {
    const text = draft.trim()
    if (!text || sending) return
    if (nickname.trim().length < 2) { Alert.alert('알림', '닉네임을 2자 이상 입력해주세요.'); return }
    // 키보드는 이 라이브러리의 API 로 닫는다. 이 앱은 keyboard-controller 가 키보드를
    // 직접 쥐고 있어서 RN 기본 Keyboard.dismiss() / blur() 로는 닫히지 않았다.
    // dismiss() 는 포커스까지 떼고, 키보드가 실제로 닫힐 때까지 기다린다.
    await KeyboardController.dismiss()
    setSending(true)
    const r = editing
      ? await updateComment(editing.id, text)
      : await createComment({
          postId: id,
          parentId: null,
          nickname: nickname.trim(),
          content: text,
          isSecret: secret,
        })
    setSending(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    const wasEditing = !!editing
    setDraft(''); setEditing(null); setSecret(false)
    setComposing(false)   // 닉네임 칸은 등록 후 다시 접어 둔다(오너 지시)
    setCommentInputH(COMPOSER_H)
    if (wasEditing) {
      // 수정은 특정 댓글로 — 방금 그 댓글이 화면 밖에 있으면 그 자리로 옮겨간다.
      setScrollToId(editing!.id)
    } else {
      // 새 댓글은 항상 목록 맨 끝에 붙는다 — 마지막 댓글이 보이도록 옮겨간다.
      // refetch 로 목록이 다시 그려지고 실제 내용 길이가 잡힐 때까지 살짝 기다린다.
      setTimeout(() => {
        const maxScroll = Math.max(0, contentHeightRef.current - viewportHeightRef.current)
        scrollRef.current?.scrollTo({ y: maxScroll, animated: true })
      }, 150)
    }
    refetch()
  }

  const openReply = (c: BoardComment) => {
    setReplyModal(c)
    setReplyDraft('')
    setReplyNickname(nickname)   // 마지막에 쓴 닉네임을 기본값으로
    // 비밀 댓글에 답할 때는 답글도 비밀이 기본이다 — 연락처를 주고받는 흐름에서
    // 답글만 공개로 나가면 그게 곧 사고다.
    setReplySecret(c.is_secret)
  }

  /**
   * 답글의 비밀 체크를 끌 때 — 비밀 댓글에 다는 답글이면 확인을 한 번 받는다.
   * 여기서 실수로 풀면 주고받으려던 연락처가 그대로 공개된다(2026-08-12 오너 지시).
   * 켜는 방향은 위험하지 않으니 그냥 켠다.
   */
  const toggleReplySecret = () => {
    if (replySecret && replyModal?.is_secret) {
      Alert.alert(
        '모두에게 공개됩니다',
        '이 답글은 비밀 댓글에 다는 답글입니다. 비밀을 끄면 연락처를 포함한 내용이 모든 사람에게 보입니다.',
        [
          { text: '취소', style: 'cancel' },
          { text: '공개로 쓰기', style: 'destructive', onPress: () => setReplySecret(false) },
        ]
      )
      return
    }
    setReplySecret((v) => !v)
  }

  const submitReply = async () => {
    if (!replyModal) return
    const text = replyDraft.trim()
    if (!text || replySending) return
    if (replyNickname.trim().length < 2) { Alert.alert('알림', '닉네임을 2자 이상 입력해주세요.'); return }
    setReplySending(true)
    const r = await createComment({
      postId: id,
      parentId: replyModal.id,
      nickname: replyNickname.trim(),
      content: text,
      isSecret: replySecret,
    })
    setReplySending(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    setReplyModal(null)
    setNickname(replyNickname.trim())   // 메인 입력줄에도 반영
    refetch()
  }

  const removeComment = (c: BoardComment) => {
    // 원 댓글을 지우면 DB cascade 로 남이 단 답글까지 함께 사라진다. 그 사실을 안 알려주면
    // 비밀 답글로 주고받던 연락처까지 통째로 날아간다(2026-08-13 감사).
    const replyCount = comments.filter((x) => x.parent_id === c.id).length
    Alert.alert(
      '댓글 삭제',
      replyCount > 0
        ? `이 댓글에 달린 답글 ${replyCount}개도 함께 삭제됩니다. 삭제할까요?`
        : '이 댓글을 삭제할까요?',
      [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          setDeletingComment(true)
          const r = await deleteComment(c.id)
          setDeletingComment(false)
          if ('error' in r) { Alert.alert('알림', r.error); return }
          refetch()
        },
      },
      ]
    )
  }

  if (loading && !post) {
    return (
      <View style={styles.container}>
        <TopBar showBack onLogoPress={() => router.replace('/board')} />
        <View style={styles.center}><AppSpinner /></View>
      </View>
    )
  }

  {/* 조회 자체가 실패한 경우("글 없음"과 구분 — 2026-08-13, board/index.tsx와 동일 이유) */}
  if (error) {
    return (
      <View style={styles.container}>
        <TopBar showBack onLogoPress={() => router.replace('/board')} />
        <View style={styles.center}>
          <Ionicons name="construct-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>일시적인 점검 중입니다</Text>
          <Text style={styles.emptySub}>잠시 후 다시 시도해주세요</Text>
        </View>
      </View>
    )
  }

  if (!post) {
    return (
      <View style={styles.container}>
        <TopBar showBack onLogoPress={() => router.replace('/board')} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>글을 찾을 수 없어요</Text>
          <Text style={styles.emptySub}>삭제되었거나 숨겨진 글입니다.</Text>
        </View>
      </View>
    )
  }

  if (postBlocked) {
    return (
      <View style={styles.container}>
        <TopBar showBack onLogoPress={() => router.replace('/board')} />
        <View style={styles.center}>
          <Ionicons name="eye-off-outline" size={28} color={colors.textTertiary} />
          <Text style={styles.emptyText}>차단한 사용자의 글이에요</Text>
          <Text style={styles.emptySub}>메뉴의 차단 목록에서 해제하면 다시 볼 수 있습니다.</Text>
        </View>
      </View>
    )
  }

  // 원댓글 아래에 답글을 붙여 보여준다(대댓글은 한 단계까지).
  //
  // 원 댓글이 신고로 숨겨지거나 내가 그 작성자를 차단하면 원 댓글만 목록에서 빠지는데,
  // 그 답글들은 살아 있어서 어디에도 안 붙어 통째로 사라졌다. "댓글 3"인데 1개만 보이는
  // 상태가 됐다(2026-08-13 감사). 부모가 없는 답글은 최상위로 올려 보여준다.
  const commentIdSet = new Set(comments.map((c) => c.id))
  const roots = comments.filter((c) => !c.parent_id || !commentIdSet.has(c.parent_id))
  const repliesOf = (pid: string) => comments.filter((c) => c.parent_id === pid)
  /**
   * 글쓴이가 자기 글에 단 댓글인가. 로그인이 없는 서비스라 작성자 식별은 owner_token
   * (기기별 익명 해시)뿐이다 — 차단 기능도 같은 값을 쓴다. 닉네임은 아무나 같게 쓸 수
   * 있어서 배지 근거로 못 쓴다.
   * 옛 글은 owner_token 이 비어 있을 수 있는데, 그때 빈 값끼리 맞아떨어져 엉뚱한 댓글에
   * 배지가 붙으면 안 되므로 양쪽 다 값이 있을 때만 본다.
   */
  const isAuthorComment = (c: BoardComment) =>
    !!post?.owner_token && !!c.owner_token && c.owner_token === post.owner_token

  return (
    <View style={styles.container}>
      <TopBar showBack onLogoPress={() => router.replace('/board')} />

      <KeyboardAvoidingView behavior="padding" style={styles.body}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[wideContent, { paddingBottom: 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y
          const now = Date.now()
          if (now - lastTickAtRef.current > 150) {
            lastTickAtRef.current = now
            setScrollTick((t) => t + 1)
          }
        }}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => { contentHeightRef.current = h }}
        onLayout={(e) => { viewportHeightRef.current = e.nativeEvent.layout.height }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.head}>
          <Text style={styles.title}>
            {!!post.board_tags?.label && <Text style={styles.titleTag}>{post.board_tags.label} </Text>}
            {post.title}
          </Text>
          {/* 수정·삭제는 닉네임·날짜와 같은 줄 오른쪽에 둔다(2026-07-31 오너 지시).
              글자 크기를 메타와 맞춰야 줄 높이가 흔들리지 않는다. */}
          <View style={styles.metaRow}>
            {/* 닉네임이 길면 액션 버튼을 밀어내지 않고 이쪽이 줄어든다(조회수를 붙이면서
                한 줄이 더 빠듯해졌다). */}
            <Text style={styles.meta} numberOfLines={1}>
              {/* 닉네임만 눌러서 그 작성자의 글·댓글 목록으로 간다(2026-08-19 오너 지시).
                  묶는 기준은 닉네임이 아니라 owner_token(기기) — 같은 닉을 여러 사람이
                  쓰고 있어서 닉네임으로 묶으면 결과가 틀린다(hooks/useBoard.ts 참고). */}
              {AUTHOR_MENU_ENABLED
                ? (
                  <Text onPress={(e) => openAuthor(post.owner_token, post.nickname, e.nativeEvent.pageX, e.nativeEvent.pageY)}>
                    {post.nickname}
                  </Text>
                )
                : post.nickname}
              {' · '}{formatFull(post.created_at)} · 조회 {displayViewCount(post).toLocaleString()}
            </Text>
            <View style={styles.metaActions}>
              {isMine ? (
                <>
                  <TouchableOpacity onPress={() => router.push(`/board/write?id=${id}`)} hitSlop={8}>
                    <Text style={styles.metaAct}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDelete} hitSlop={8}>
                    <Text style={[styles.metaAct, styles.metaActDanger]}>삭제</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => handleBlockAuthor(post.nickname, post.owner_token, true, 'post', id)} hitSlop={8}>
                    <Text style={styles.metaAct}>차단</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setReportTarget({ type: 'post', id })} hitSlop={8}>
                    <Text style={styles.metaAct}>신고</Text>
                  </TouchableOpacity>
                  {/* 사진·유튜브 링크 등 첨부물 전체를 하나로 신고(2026-08-13 일반화) —
                      신고되면 첨부만 가려지고 글은 그대로 보인다. */}
                  {(!!post.image_urls?.length || !!post.link_urls?.length) && !post.content_hidden && (
                    <TouchableOpacity onPress={() => setReportTarget({ type: 'content', id })} hitSlop={8}>
                      <Text style={styles.metaAct}>첨부 신고</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.postBody}>
          {/* 리치 글(HTML)은 서식대로, 옛 평문 글은 그대로 — PostHtmlView 가 자동 구분 */}
          <PostHtmlView content={post.content} textStyle={styles.bodyText} colors={colors} />
        </View>

        {/* 첨부(사진+링크) 신고 누적 시 이미지처럼 통째로 안 그리고 가림 문구로 대신한다
            (2026-08-13 일반화 — 반투명 덮개는 밝은 사진·썸네일이 비쳐 보여 가린 게
            아니었던 예전 문제와 동일하게 피한다). */}
        {!!post.link_urls?.length && (
          <View style={styles.images}>
            {post.content_hidden ? (
              <View style={[styles.imageWrap, styles.imageBlocked]}>
                <Ionicons name="eye-off-outline" size={22} color={colors.textSecondary} />
                <Text style={styles.imageBlockedText}>첨부 검수 중</Text>
                <Text style={styles.imageBlockedSub}>신고가 접수되어 확인하고 있습니다</Text>
              </View>
            ) : post.link_urls.map((u) => (
              <TouchableOpacity key={u} style={styles.imageWrap} onPress={() => openOutlink(u)} activeOpacity={0.85}>
                <Image source={{ uri: youtubeThumbnail(u) ?? undefined }} style={styles.image} contentFit="cover" />
                <View style={styles.linkPlayBadge}>
                  <Ionicons name="play" size={22} color="#fff" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!!post.image_urls?.length && (
          <View style={styles.images}>
            {post.content_hidden ? (
              <View style={[styles.imageWrap, styles.imageBlocked]}>
                <Ionicons name="eye-off-outline" size={22} color={colors.textSecondary} />
                <Text style={styles.imageBlockedText}>첨부 검수 중</Text>
                <Text style={styles.imageBlockedSub}>신고가 접수되어 확인하고 있습니다</Text>
              </View>
            ) : post.image_urls.map((u) => (
              <View key={u} style={styles.imageWrap}>
                <LazyPostImage uri={u} style={styles.image} scrollTick={scrollTick} />
              </View>
            ))}
          </View>
        )}

        {/* 첨부(사진·유튜브) 아래에 이어 쓰는 본문(2026-08-21). 있을 때만 렌더 —
            윗글(post.content)과 같은 스타일. 첨부가 신고로 가려져도 이 글은 그대로 보인다. */}
        {!!post.content_below && (
          <View style={styles.postBody}>
            <Text style={styles.bodyText} selectable>{post.content_below}</Text>
          </View>
        )}

        <View style={styles.votes}>
          <TouchableOpacity
            style={[styles.voteBtn, myVote === 1 && styles.voteBtnOn]}
            onPress={() => handleVote(1)}
            disabled={voting}
          >
            <Ionicons name={myVote === 1 ? 'thumbs-up' : 'thumbs-up-outline'} size={17} color={myVote === 1 ? colors.primary : colors.textSecondary} />
            <Text style={[styles.voteText, myVote === 1 && styles.voteTextOn]}>추천 {post.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.voteBtn, myVote === -1 && styles.voteBtnOn]}
            onPress={() => handleVote(-1)}
            disabled={voting}
          >
            <Ionicons name={myVote === -1 ? 'thumbs-down' : 'thumbs-down-outline'} size={17} color={myVote === -1 ? colors.primary : colors.textSecondary} />
            <Text style={[styles.voteText, myVote === -1 && styles.voteTextOn]}>비추 {post.downvotes}</Text>
          </TouchableOpacity>
          {/* 스크랩 — MY 탭 개편(2026-08-21)과 함께 노출. 전환 전까지 NEW_TABS 로 숨긴다. */}
          {NEW_TABS_ENABLED && (
            <TouchableOpacity
              style={[styles.voteBtn, scrapOn && styles.voteBtnOn]}
              onPress={handleScrap}
              disabled={scrapping}
            >
              <Ionicons name={scrapOn ? 'bookmark' : 'bookmark-outline'} size={17} color={scrapOn ? colors.primary : colors.textSecondary} />
              <Text style={[styles.voteText, scrapOn && styles.voteTextOn]}>스크랩</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.commentHeadRow}>
          <Text style={styles.commentHead}>댓글 {post.comment_count}</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.listLinkText}>목록으로</Text>
          </TouchableOpacity>
        </View>

        {roots.length === 0 && (
          <Text style={styles.noComment}>첫 댓글을 남겨보세요</Text>
        )}

        {roots.map((c) => (
          // 각 댓글이 어디에 그려졌는지 기억해 둔다. 방금 쓰거나 수정한 댓글로
          // 옮겨가야 한다(2026-08-01 조사).
          <View key={c.id} onLayout={(e) => { commentY.current[c.id] = e.nativeEvent.layout.y }}>
            <CommentRow
              c={c} mine={myCommentIds.includes(c.id)} styles={styles} colors={colors}
              byAuthor={isAuthorComment(c)}
              // 부모를 잃고 올라온 답글은 답글 표시를 유지한다(답글에는 다시 답글을 못 단다)
              reply={!!c.parent_id}
              onReply={c.parent_id ? undefined : () => openReply(c)}
              onEdit={() => { setEditing(c); setDraft(c.content) }}
              onDelete={() => removeComment(c)}
              onReport={() => setReportTarget({ type: 'comment', id: c.id })}
              onBlock={() => handleBlockAuthor(c.nickname, c.owner_token, false, 'comment', c.id)}
              onAuthorPress={(x, y) => openAuthor(c.owner_token, c.nickname, x, y)}
            />
            {repliesOf(c.id).map((r) => (
              <CommentRow
                key={r.id} c={r} reply mine={myCommentIds.includes(r.id)} styles={styles} colors={colors}
                byAuthor={isAuthorComment(r)}
                onLayout={(y) => { commentY.current[r.id] = (commentY.current[c.id] ?? 0) + y }}
                onEdit={() => { setEditing(r); setDraft(r.content) }}
                onDelete={() => removeComment(r)}
                onReport={() => setReportTarget({ type: 'comment', id: r.id })}
                onBlock={() => handleBlockAuthor(r.nickname, r.owner_token, false, 'comment', r.id)}
                onAuthorPress={(x, y) => openAuthor(r.owner_token, r.nickname, x, y)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* 댓글 입력 — 화면 아래 붙박이. 위 KeyboardAvoidingView 가 키보드만큼 영역을
          줄여주므로 따로 띄우지 않는다. */}
      <View style={[styles.inputWrap, { paddingBottom: (keyboardShown ? 8 : insets.bottom + 8) }]}>
          {/* 키보드 닫는 버튼은 두지 않는다. 목록을 아래로 쓸어내리면 닫힌다
              (keyboardDismissMode="interactive"). 애플 가이드라인도 키보드 위에는
              '지금 하는 일에 관련된' 컨트롤만 두고 시스템 기능을 겹쳐 놓지 말라고
              한다(2026-08-01 조사). */}
          {!!editing && (
            <View style={styles.inputHint}>
              <Text style={styles.inputHintText}>댓글 수정 중</Text>
              <TouchableOpacity onPress={() => { setEditing(null); setDraft(''); setCommentInputH(COMPOSER_H) }} hitSlop={8}>
                <Text style={styles.inputHintCancel}>취소</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* 닉네임은 입력칸을 만졌을 때만 펼친다. 마지막에 쓴 값이 채워져 있어서
              보통은 손댈 일이 없는데 늘 한 줄을 차지하고 있었다.
              비밀 댓글 체크도 같은 줄에 둔다 — 늘 보이면 자리만 차지한다.
              수정 중에는 비밀 여부를 바꿀 수 없다(이미 본 사람과 못 본 사람이 갈린다). */}
          {composing && (
            <View style={styles.composeOptionRow}>
              <TextInput
                style={styles.nickInput}
                value={nickname}
                onChangeText={setNickname}
                placeholder="닉네임"
                placeholderTextColor={colors.textTertiary}
                maxLength={20}
              />
              {!editing && (
                <TouchableOpacity
                  style={styles.secretToggle}
                  onPress={() => setSecret((v) => !v)}
                  hitSlop={6}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: secret }}
                >
                  <Ionicons
                    name={secret ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={secret ? colors.primary : colors.textTertiary}
                  />
                  <Text style={[styles.secretToggleText, secret && styles.secretToggleTextOn]}>비밀</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {secret && !editing && (
            <Text style={styles.secretHint}>
              글쓴이와 나만 볼 수 있어요. 연락처를 남겨도 다른 사람에게는 보이지 않습니다.
            </Text>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.commentInput, { height: Math.min(96, Math.max(COMPOSER_H, commentInputH)) }]}
              value={draft}
              onChangeText={(t) => { setDraft(t); if (!t) setCommentInputH(COMPOSER_H) }}
              placeholder="댓글을 입력하세요"
              placeholderTextColor={colors.textTertiary}
              multiline
              onContentSizeChange={(e) => setCommentInputH(e.nativeEvent.contentSize.height)}
              onFocus={() => setComposing(true)}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
              onPress={submitComment}
              disabled={!draft.trim() || sending}
            >
              <Text style={styles.sendBtnText}>{editing ? '수정' : '등록'}</Text>
            </TouchableOpacity>
          </View>
      </View>
      </KeyboardAvoidingView>

      <LoadingOverlay visible={sending || voting || deletingPost || blockingAuthor || deletingComment || replySending} />
      <AuthorMenu target={authorMenu} onClose={() => setAuthorMenu(null)} />

      <ReplyModal
        target={replyModal}
        nickname={replyNickname}
        draft={replyDraft}
        secret={replySecret}
        sending={replySending}
        colors={colors}
        onChangeNickname={setReplyNickname}
        onChangeDraft={setReplyDraft}
        onToggleSecret={toggleReplySecret}
        onCancel={() => setReplyModal(null)}
        onSubmit={submitReply}
      />

      <ReportSheet
        visible={reportTarget !== null}
        reviewId={null}
        board={reportTarget}
        onClose={() => setReportTarget(null)}
        onReported={(already) => {
          Alert.alert('신고되었습니다', already ? '이미 신고한 대상입니다.' : '검토 후 조치하겠습니다.')
          refetch()
        }}
      />
    </View>
  )
}

/**
 * 답글 팝업 — mlbpark 등 실제 커뮤니티가 쓰는 방식(2026-08-01 오너 지시).
 * "OOO님에게 답글" 표시가 팝업 안에 있으므로, 목록을 스크롤해 대상 댓글을
 * 입력줄 위로 맞출 필요가 없다.
 */
function ReplyModal({
  target, nickname, draft, secret, sending, colors,
  onChangeNickname, onChangeDraft, onToggleSecret, onCancel, onSubmit,
}: {
  target: BoardComment | null
  nickname: string
  draft: string
  secret: boolean
  sending: boolean
  colors: AppColors
  onChangeNickname: (v: string) => void
  onChangeDraft: (v: string) => void
  onToggleSecret: () => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const styles = useMemo(() => makeReplyModalStyles(colors), [colors])
  // 메인 댓글칸과 같은 규칙 — 닉네임 칸은 입력칸을 만졌을 때만 펼친다.
  // 팝업이 새로 열릴 때(대상이 바뀔 때)마다 접힌 상태로 되돌린다.
  const [nickComposing, setNickComposing] = useState(false)
  useEffect(() => { if (target) setNickComposing(false) }, [target])

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      {/* 화면 정가운데(justifyContent: 'center')가 톱바 뒤 빈 공간까지 셈에 들어가
          살짝 위로 치우쳐 보인다는 지적이 있었지만, 고정 픽셀 값으로 보정했다가
          기기마다 화면 크기·비율이 달라 안드로이드에서 훨씬 더 어긋났다
          (2026-08-01). 고정값 대신 상대적인 가운데 정렬로 되돌린다 — 화면 크기와
          무관하게 항상 남은 공간 기준으로 맞다. */}
      <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{target?.nickname}님에게 답글</Text>
          {nickComposing && (
            <TextInput
              style={styles.nickInput}
              value={nickname}
              onChangeText={onChangeNickname}
              placeholder="닉네임"
              placeholderTextColor={colors.textTertiary}
              maxLength={20}
            />
          )}
          <TextInput
            style={styles.draftInput}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="답글을 입력하세요"
            placeholderTextColor={colors.textTertiary}
            multiline
            autoFocus
            onFocus={() => setNickComposing(true)}
          />
          <View style={styles.actions}>
            {/* 비밀 댓글에 답할 때는 기본으로 켜져 있다(openReply). 연락처를 주고받는
                흐름에서 답글만 공개로 나가면 그게 곧 사고다. */}
            <TouchableOpacity
              style={styles.secretToggle}
              onPress={onToggleSecret}
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: secret }}
            >
              <Ionicons
                name={secret ? 'checkbox' : 'square-outline'}
                size={18}
                color={secret ? colors.primary : colors.textTertiary}
              />
              <Text style={[styles.secretToggleText, secret && styles.secretToggleTextOn]}>비밀</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.actionBtn} onPress={onCancel} hitSlop={8}>
              <Text style={styles.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onSubmit}
              disabled={!draft.trim() || sending}
              hitSlop={8}
            >
              <Text style={[styles.submitText, (!draft.trim() || sending) && styles.submitTextOff]}>등록</Text>
            </TouchableOpacity>
          </View>
          {/* 지금 답글 다는 대상 댓글 원문 — 오너가 캡처해준 참고 화면대로 팝업
              맨 아래에 보여준다. 목록으로 안 돌아가도 뭐에 답하는지 알 수 있다. */}
          {!!target && (
            <View style={styles.targetBox}>
              <Text style={styles.targetMeta}>{target.nickname} · {formatFull(target.created_at)}</Text>
              <Text style={styles.targetBody}>{target.content}</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function makeReplyModalStyles(colors: AppColors) {
  return StyleSheet.create({
    // 팝업과 뒤 배경이 잘 구분 안 된다는 지적(2026-08-01, 아이폰·안드로이드 둘 다) —
    // 배경을 더 어둡게 하고 카드에 테두리·그림자를 줘서 구분되게 한다. 흐림 효과는
    // expo-blur 를 새로 추가해야 해서(네이티브 재빌드 필요) 쓰지 않는다.
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: {
      width: '100%', maxWidth: 400, borderRadius: 16, backgroundColor: colors.surface, padding: 16, gap: 10,
      borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16,
      elevation: 12,
    },
    title: { fontSize: 14, fontWeight: '700', color: colors.primary },
    nickInput: {
      fontSize: 13, color: colors.textPrimary, backgroundColor: colors.surfaceHigh,
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    },
    draftInput: {
      minHeight: 90, maxHeight: 160, fontSize: 14, lineHeight: 20, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
      // 안드로이드는 여러 줄 입력칸 기본이 세로 가운데 정렬이다(iOS는 위부터).
      // 안드로이드 전용 속성이라 iOS는 그냥 무시한다.
      textAlignVertical: 'top',
    },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingTop: 4 },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    secretToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
    secretToggleText: { fontSize: 13, color: colors.textSecondary },
    secretToggleTextOn: { color: colors.primary, fontWeight: '700' },
    cancelText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
    submitText: { fontSize: 14, color: colors.primary, fontWeight: '800' },
    submitTextOff: { color: colors.border },
    targetBox: {
      borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10, gap: 4,
    },
    targetMeta: { fontSize: 11.5, color: colors.textTertiary },
    targetBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  })
}

function CommentRow({
  c, reply = false, mine, byAuthor = false, styles, colors, onReply, onEdit, onDelete, onReport, onBlock, onAuthorPress, onLayout,
}: {
  c: BoardComment
  reply?: boolean
  mine: boolean
  /** 글쓴이가 자기 글에 단 댓글이면 true — 닉네임 앞에 '작성자' 배지를 붙인다. */
  byAuthor?: boolean
  styles: ReturnType<typeof makeStyles>
  colors: AppColors
  onReply?: () => void
  onEdit: () => void
  onDelete: () => void
  onReport: () => void
  onBlock: () => void
  onAuthorPress: (x: number, y: number) => void
  /** 답글의 부모 안에서의 세로 위치 */
  onLayout?: (y: number) => void
}) {
  // 비밀 댓글인데 본문이 비어 있으면 = 볼 자격이 없는 사람이다. 서버가 애초에
  // 본문을 안 내려준다(화면에서만 가리는 게 아니다).
  const locked = c.is_secret && !c.content

  return (
    <View
      style={[styles.comment, reply && styles.commentReply]}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.y)}
    >
      {/* 수정·삭제(신고)는 닉네임·날짜와 같은 줄 오른쪽. 글자 크기·줄높이를 메타와
          똑같이 맞춰 줄 간격이 밀리지 않게 한다(2026-07-31 오너 지시). */}
      <View style={styles.commentMetaRow}>
        {/* 배지는 메타 텍스트와 같은 줄에 두되 별도 View 로 둔다 — Text 안에 배경을 넣으면
            iOS 에서 배경 높이가 줄 높이를 밀어 댓글 간격이 흔들린다. */}
        <View style={styles.commentMetaLeft}>
          {byAuthor && (
            <View style={styles.authorBadge}>
              <Text style={styles.authorBadgeText}>작성자</Text>
            </View>
          )}
          <Text style={styles.commentMeta} numberOfLines={1}>
            {/* 닉네임만 눌러 그 작성자의 활동으로 이동(2026-08-19 오너 지시) */}
            {AUTHOR_MENU_ENABLED
              ? <Text onPress={(e) => onAuthorPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}>{c.nickname}</Text>
              : c.nickname}
            {' · '}{formatFull(c.created_at)}
          </Text>
        </View>
        <View style={styles.commentManage}>
          {mine ? (
            <>
              <TouchableOpacity onPress={onEdit} hitSlop={8}>
                <Text style={styles.commentMetaAct}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} hitSlop={8}>
                <Text style={[styles.commentMetaAct, styles.commentActDanger]}>삭제</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={onBlock} hitSlop={8}>
                <Text style={styles.commentMetaAct}>차단</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onReport} hitSlop={8}>
                <Text style={styles.commentMetaAct}>신고</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      {locked ? (
        <View style={styles.secretLockRow}>
          <Ionicons name="lock-closed" size={13} color={colors.textTertiary} />
          <Text style={styles.secretLockText}>비밀 댓글입니다</Text>
        </View>
      ) : (
        <Text style={styles.commentBody}>
          {c.is_secret && <Text style={styles.secretBadge}>🔒 </Text>}
          {c.content}
        </Text>
      )}
      {/* 답글에는 다시 답글을 달 수 없다(대댓글 한 단계).
          내용을 못 보는 비밀 댓글에는 답글을 달 수 없게 한다 — 뭐에 답하는지 모른다. */}
      {!reply && onReply && !locked && (
        <View style={styles.commentActions}>
          <TouchableOpacity onPress={onReply} hitSlop={6}>
            <Text style={styles.commentAct}>답글</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

function formatFull(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
    emptyText: { fontSize: 15, color: colors.textSecondary },
    emptySub: { fontSize: 13, color: colors.textTertiary },

    // 위쪽 여백을 다른 페이지 제목들과 통일(8px, 2026-08-12).
    head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 5,
      borderBottomWidth: 1, borderBottomColor: colors.divider },
    // lineHeight 명시 필수 — 이모지가 잘려 보이는 문제(rowTitle과 동일 원인, 목록 쪽 주석 참고)
    title: { fontSize: 18, fontWeight: '800', lineHeight: 25, color: colors.textPrimary, letterSpacing: -0.3 },
    titleTag: { color: colors.primary },
    // flexShrink 가 없으면 긴 닉네임 + 조회수에 밀려 오른쪽 수정·삭제가 화면 밖으로 나간다.
    meta: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    metaActions: { flexDirection: 'row', gap: 12 },
    // 메타와 같은 크기·줄높이 — 다르면 줄 간격이 어긋난다
    metaAct: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    metaActDanger: { color: colors.error },

    body: { flex: 1 },
    postBody: { paddingHorizontal: 16, paddingVertical: 16 },
    bodyText: { fontSize: 15, lineHeight: 23, color: colors.textPrimary },

    images: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
    imageWrap: { position: 'relative', borderRadius: 10, overflow: 'hidden' },
    image: { width: '100%', height: 220, backgroundColor: colors.surfaceHigh },
    // 가림 = 사진을 아예 안 그리고 이 자리를 대신 채운다
    imageBlocked: {
      height: 220, alignItems: 'center', justifyContent: 'center', gap: 5,
      backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border,
    },
    imageBlockedText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    imageBlockedSub: { color: colors.textTertiary, fontSize: 11.5 },
    // 유튜브 링크 썸네일 위 재생 배지 — 탭하면 외부(유튜브 앱/브라우저)에서 재생(인앱 재생 아님).
    linkPlayBadge: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.25)',
    },

    votes: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 14 },
    voteBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    voteBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
    voteText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    voteTextOn: { color: colors.primary, fontWeight: '800' },

    commentHeadRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    commentHead: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    // 테두리 없는 글자만(오너 지시) — 수정·삭제·신고 같은 기존 텍스트 링크와 같은 톤.
    listLinkText: { fontSize: 12.5, color: colors.textSecondary },
    noComment: { fontSize: 13, color: colors.textTertiary, paddingHorizontal: 16, paddingVertical: 12 },

    comment: { paddingHorizontal: 16, paddingVertical: 11, gap: 4,
      borderTopWidth: 1, borderTopColor: colors.divider },
    commentReply: { paddingLeft: 34, backgroundColor: colors.surface },
    commentMeta: { flexShrink: 1, fontSize: 11.5, lineHeight: 16, color: colors.textTertiary },
    commentMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    // 배지 + 닉네임·날짜를 한 덩어리로 묶어, 길어지면 오른쪽 관리 버튼 대신 이쪽이 줄어든다.
    commentMetaLeft: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
    // 줄 높이(16)를 넘기지 않도록 세로 여백은 1로 최소화한다 — 댓글 간격이 밀리면 안 된다.
    authorBadge: {
      paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
      // 연한 핑크 배경 — 톱바 토글(TopBar.tsx)이 쓰는 `primary`+30 과 같은 농도로 맞춘다.
      backgroundColor: `${colors.primary}30`,
    },
    authorBadgeText: { fontSize: 10, lineHeight: 14, fontWeight: '700', color: colors.primary },
    commentManage: { flexDirection: 'row', gap: 12 },
    commentMetaAct: { fontSize: 11.5, lineHeight: 16, color: colors.textSecondary },
    commentBody: { fontSize: 14, lineHeight: 21, color: colors.textPrimary },
    // 볼 자격이 없는 비밀 댓글 — 자리만 남기고 내용은 서버가 아예 안 내려준다.
    secretLockRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    secretLockText: { fontSize: 13.5, color: colors.textTertiary, fontStyle: 'italic' },
    secretBadge: { fontSize: 12 },
    commentActions: { flexDirection: 'row', gap: 12, marginTop: 2 },
    commentAct: { fontSize: 12, color: colors.textSecondary },
    commentActDanger: { color: colors.error },

    inputWrap: { borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.background,
      paddingHorizontal: 12, paddingTop: 8 },
    inputHint: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 },
    inputHintText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    inputHintCancel: { fontSize: 12, color: colors.textSecondary },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // 닉네임 칸과 '비밀' 체크를 한 줄에 — 둘 다 입력칸을 만졌을 때만 나온다.
    composeOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
    nickInput: {
      minWidth: 110, fontSize: 13, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    secretToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    secretToggleText: { fontSize: 13, color: colors.textSecondary },
    secretToggleTextOn: { color: colors.primary, fontWeight: '700' },
    secretHint: { fontSize: 11.5, lineHeight: 16, color: colors.textTertiary, marginBottom: 6 },
    // 한 줄일 때 입력칸과 등록 버튼의 높이가 정확히 같아야 한다. 높이는 여기서
    // 정하지 않고 JS 에서 직접 숫자로 준다(위 commentInputH) — CSS 최솟값에
    // 맡기면 iOS 가 내부 여백만큼 더 키워서 버튼과 안 맞았다.
    commentInput: {
      flex: 1,
      fontSize: 14, lineHeight: 20, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 9,
    },
    sendBtn: {
      minHeight: COMPOSER_H, justifyContent: 'center',
      paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.primary,
    },
    sendBtnOff: { backgroundColor: colors.border },
    sendBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  })
}
