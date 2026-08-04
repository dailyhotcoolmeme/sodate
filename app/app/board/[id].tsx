import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, RefreshControl, Modal, Pressable,
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
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useBoardPost } from '@/hooks/useBoard'
import {
  vote, deletePost, createComment, updateComment, deleteComment, markViewed, report,
} from '@/lib/board'
import { getLastNickname } from '@/lib/reviewIdentity'
import { blockAuthor } from '@/lib/boardIdentity'
import { wideContent } from '@/constants/layout'
import type { BoardComment } from '@/lib/board'
import { useRefreshIndicator } from '@/hooks/useRefreshIndicator'

/** 댓글 입력칸과 등록 버튼의 한 줄 높이 */
const COMPOSER_H = 38

/** 글 상세 — 추천·비추, 댓글(대댓글 한 단계), 내 글이면 수정·삭제. */
export default function BoardPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const { post, postBlocked, comments, myVote, isMine, myCommentIds, loading, refetch } = useBoardPost(id)

  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)

  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  const [voting, setVoting] = useState(false)
  const [nickname, setNickname] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<BoardComment | null>(null)
  const [sending, setSending] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment' | 'image'; id: string } | null>(null)
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
  const [replyModal, setReplyModal] = useState<BoardComment | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyNickname, setReplyNickname] = useState('')
  const [replySending, setReplySending] = useState(false)
  // 목록(ScrollView) 실제 내용 길이·창 높이. 얼마나 밀 수 있는지, 밀 필요가
  // 있기는 한지 계산하는 데 쓴다. 억지로 여백을 만들어 늘리지 않는다 — 댓글이
  // 하나뿐인 글처럼 가릴 내용 자체가 없으면 밀 필요도 없다(2026-08-01 실측).
  const contentHeightRef = useRef(0)
  const viewportHeightRef = useRef(0)

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

  // 방금 쓰거나 수정한 댓글이 화면 밖에 있으면 그 자리로 옮겨간다(등록 후).
  // 목록이 새로 그려진 뒤에 옮겨간다. 위치를 아직 모르면 다음 그리기까지 기다린다.
  useEffect(() => {
    if (!scrollToId) return
    const y = commentY.current[scrollToId]
    if (y == null) return
    const maxScroll = Math.max(0, contentHeightRef.current - viewportHeightRef.current)
    scrollRef.current?.scrollTo({ y: Math.min(Math.max(0, y - 80), maxScroll), animated: true })
    setScrollToId(null)
  }, [scrollToId, comments])

  // 닉네임은 가장 최근에 쓴 값을 물고 간다(후기 작성과 동일). 여기서 바꾸면
  // 그 값이 다음부터 기본값이 된다 — 저장은 lib/board.ts 에서 한다.
  useEffect(() => { getLastNickname().then((n) => n && setNickname(n)) }, [])
  // 조회수는 화면에 감춰뒀지만 값은 쌓아둔다(나중에 켜면 그때까지 숫자가 그대로).
  useEffect(() => { if (id) markViewed(id) }, [id])
  useFocusEffect(useCallback(() => { refetch() }, [refetch]))


  const handleVote = async (value: 1 | -1) => {
    if (voting) return
    setVoting(true)
    const r = await vote(id, value)
    setVoting(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    refetch()
  }

  const handleDelete = () => {
    Alert.alert('글 삭제', '이 글을 삭제할까요? 댓글도 함께 사라집니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          const r = await deletePost(id)
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
            await blockAuthor(ownerToken, targetNickname)
            await report(targetType, targetId, '사용자 차단')
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
        })
    setSending(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    const wasEditing = !!editing
    setDraft(''); setEditing(null)
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
    })
    setReplySending(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    setReplyModal(null)
    setNickname(replyNickname.trim())   // 메인 입력줄에도 반영
    refetch()
  }

  const removeComment = (c: BoardComment) => {
    Alert.alert('댓글 삭제', '이 댓글을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive',
        onPress: async () => {
          const r = await deleteComment(c.id)
          if ('error' in r) { Alert.alert('알림', r.error); return }
          refetch()
        },
      },
    ])
  }

  if (loading && !post) {
    return (
      <View style={styles.container}>
        <TopBar showBack onLogoPress={() => router.replace('/board')} />
        <View style={styles.center}><AppSpinner /></View>
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
  const roots = comments.filter((c) => !c.parent_id)
  const repliesOf = (pid: string) => comments.filter((c) => c.parent_id === pid)

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
        onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y }}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => { contentHeightRef.current = h }}
        onLayout={(e) => { viewportHeightRef.current = e.nativeEvent.layout.height }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.head}>
          <Text style={styles.title}>{post.title}</Text>
          {/* 수정·삭제는 닉네임·날짜와 같은 줄 오른쪽에 둔다(2026-07-31 오너 지시).
              글자 크기를 메타와 맞춰야 줄 높이가 흔들리지 않는다. */}
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{post.nickname} · {formatFull(post.created_at)}</Text>
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
                  {!!post.image_urls?.length && !post.image_hidden && (
                    <TouchableOpacity onPress={() => setReportTarget({ type: 'image', id })} hitSlop={8}>
                      <Text style={styles.metaAct}>이미지 신고</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.postBody}>
          <Text style={styles.bodyText} selectable>{post.content}</Text>
        </View>

        {!!post.image_urls?.length && (
          <View style={styles.images}>
            {post.image_urls.map((u) => (
              // 가려진 이미지는 아예 그리지 않는다. 반투명 덮개를 씌우는 방식은
              // 밝은 사진이 그대로 비쳐 보여 가린 게 아니었다(2026-07-31 오너 지적).
              post.image_hidden ? (
                <View key={u} style={[styles.imageWrap, styles.imageBlocked]}>
                  <Ionicons name="eye-off-outline" size={22} color={colors.textSecondary} />
                  <Text style={styles.imageBlockedText}>이미지 검수 중</Text>
                  <Text style={styles.imageBlockedSub}>신고가 접수되어 확인하고 있습니다</Text>
                </View>
              ) : (
                <View key={u} style={styles.imageWrap}>
                  <Image source={{ uri: u }} style={styles.image} contentFit="cover" />
                </View>
              )
            ))}
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
              c={c} mine={myCommentIds.includes(c.id)} styles={styles}
              onReply={() => openReply(c)}
              onEdit={() => { setEditing(c); setDraft(c.content) }}
              onDelete={() => removeComment(c)}
              onReport={() => setReportTarget({ type: 'comment', id: c.id })}
              onBlock={() => handleBlockAuthor(c.nickname, c.owner_token, false, 'comment', c.id)}
            />
            {repliesOf(c.id).map((r) => (
              <CommentRow
                key={r.id} c={r} reply mine={myCommentIds.includes(r.id)} styles={styles}
                onLayout={(y) => { commentY.current[r.id] = (commentY.current[c.id] ?? 0) + y }}
                onEdit={() => { setEditing(r); setDraft(r.content) }}
                onDelete={() => removeComment(r)}
                onReport={() => setReportTarget({ type: 'comment', id: r.id })}
                onBlock={() => handleBlockAuthor(r.nickname, r.owner_token, false, 'comment', r.id)}
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
              보통은 손댈 일이 없는데 늘 한 줄을 차지하고 있었다. */}
          {composing && (
            <TextInput
              style={styles.nickInput}
              value={nickname}
              onChangeText={setNickname}
              placeholder="닉네임"
              placeholderTextColor={colors.textTertiary}
              maxLength={20}
            />
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

      <LoadingOverlay visible={sending || voting} />

      <ReplyModal
        target={replyModal}
        nickname={replyNickname}
        draft={replyDraft}
        sending={replySending}
        colors={colors}
        onChangeNickname={setReplyNickname}
        onChangeDraft={setReplyDraft}
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
  target, nickname, draft, sending, colors, onChangeNickname, onChangeDraft, onCancel, onSubmit,
}: {
  target: BoardComment | null
  nickname: string
  draft: string
  sending: boolean
  colors: AppColors
  onChangeNickname: (v: string) => void
  onChangeDraft: (v: string) => void
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
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, paddingTop: 4 },
    actionBtn: { paddingVertical: 6, paddingHorizontal: 4 },
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
  c, reply = false, mine, styles, onReply, onEdit, onDelete, onReport, onBlock, onLayout,
}: {
  c: BoardComment
  reply?: boolean
  mine: boolean
  styles: ReturnType<typeof makeStyles>
  onReply?: () => void
  onEdit: () => void
  onDelete: () => void
  onReport: () => void
  onBlock: () => void
  /** 답글의 부모 안에서의 세로 위치 */
  onLayout?: (y: number) => void
}) {
  return (
    <View
      style={[styles.comment, reply && styles.commentReply]}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.y)}
    >
      {/* 수정·삭제(신고)는 닉네임·날짜와 같은 줄 오른쪽. 글자 크기·줄높이를 메타와
          똑같이 맞춰 줄 간격이 밀리지 않게 한다(2026-07-31 오너 지시). */}
      <View style={styles.commentMetaRow}>
        <Text style={styles.commentMeta}>{c.nickname} · {formatFull(c.created_at)}</Text>
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
      <Text style={styles.commentBody}>{c.content}</Text>
      {/* 답글에는 다시 답글을 달 수 없다(대댓글 한 단계) */}
      {!reply && onReply && (
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

    head: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 5,
      borderBottomWidth: 1, borderBottomColor: colors.divider },
    title: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.3 },
    meta: { fontSize: 12, lineHeight: 17, color: colors.textTertiary },
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
    commentMeta: { fontSize: 11.5, lineHeight: 16, color: colors.textTertiary },
    commentMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    commentManage: { flexDirection: 'row', gap: 12 },
    commentMetaAct: { fontSize: 11.5, lineHeight: 16, color: colors.textSecondary },
    commentBody: { fontSize: 14, lineHeight: 21, color: colors.textPrimary },
    commentActions: { flexDirection: 'row', gap: 12, marginTop: 2 },
    commentAct: { fontSize: 12, color: colors.textSecondary },
    commentActDanger: { color: colors.error },

    inputWrap: { borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.background,
      paddingHorizontal: 12, paddingTop: 8 },
    inputHint: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 6 },
    inputHintText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    inputHintCancel: { fontSize: 12, color: colors.textSecondary },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    nickInput: {
      alignSelf: 'flex-start', minWidth: 110, fontSize: 13, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7, marginBottom: 6,
    },
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
