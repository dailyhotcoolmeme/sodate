import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, RefreshControl,
} from 'react-native'
// 키보드가 올라오면 '내용 영역 자체가 줄어든다'. 애플이 keyboard layout guide 로
// 설명하는 방식이다 — 보던 자리는 그대로 있고 목록 끝까지 접근할 수 있다.
// 입력줄만 띄우고 목록을 그대로 두면 아래쪽 댓글이 덮여 손이 닿지 않는다
// (2026-08-01 오너 지적 후 조사). RN 기본 KeyboardAvoidingView 는 여러 줄 입력에서
// 동작하지 않으므로(react-native#16826) 이 라이브러리 것을 쓴다.
import { KeyboardAvoidingView, KeyboardController, useKeyboardState } from 'react-native-keyboard-controller'
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
  vote, deletePost, createComment, updateComment, deleteComment, markViewed,
} from '@/lib/board'
import { getLastNickname } from '@/lib/reviewIdentity'
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

  const { post, comments, myVote, isMine, myCommentIds, loading, refetch } = useBoardPost(id)

  // 당김 표시는 다른 앱처럼 잠깐 붙잡아 둔다(거리는 iOS 기본값 그대로)

  const { refreshing, onRefresh } = useRefreshIndicator(loading, refetch)
  const [voting, setVoting] = useState(false)
  const [nickname, setNickname] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<BoardComment | null>(null)
  const [editing, setEditing] = useState<BoardComment | null>(null)
  const [sending, setSending] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment' | 'image'; id: string } | null>(null)
  const keyboardShown = useKeyboardState((k) => k.isVisible)
  const [composing, setComposing] = useState(false)   // 입력칸을 만졌는가(닉네임 줄 펼침)
  const scrollRef = useRef<ScrollView>(null)
  // 댓글마다 화면에서의 세로 위치. 새 댓글·답글로 옮겨갈 때 쓴다.
  const commentY = useRef<Record<string, number>>({})
  const [scrollToId, setScrollToId] = useState<string | null>(null)

  // 목록이 새로 그려진 뒤에 옮겨간다. 위치를 아직 모르면 다음 그리기까지 기다린다.
  useEffect(() => {
    if (!scrollToId) return
    const y = commentY.current[scrollToId]
    if (y == null) return
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true })
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
          parentId: replyTo?.id ?? null,
          nickname: nickname.trim(),
          content: text,
        })
    setSending(false)
    if ('error' in r) { Alert.alert('알림', r.error); return }
    setDraft(''); setReplyTo(null); setEditing(null)
    // 방금 쓴 댓글이 화면 밖에 있으면 올라간 줄 모른다. 그 자리로 옮겨간다.
    setScrollToId(editing ? editing.id : ('id' in r ? r.id : null))
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
            <Ionicons name="chevron-up" size={18} color={myVote === 1 ? colors.primary : colors.textSecondary} />
            <Text style={[styles.voteText, myVote === 1 && styles.voteTextOn]}>추천 {post.upvotes}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.voteBtn, myVote === -1 && styles.voteBtnOn]}
            onPress={() => handleVote(-1)}
            disabled={voting}
          >
            <Ionicons name="chevron-down" size={18} color={myVote === -1 ? colors.primary : colors.textSecondary} />
            <Text style={[styles.voteText, myVote === -1 && styles.voteTextOn]}>비추 {post.downvotes}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.commentHead}>댓글 {post.comment_count}</Text>

        {roots.length === 0 && (
          <Text style={styles.noComment}>첫 댓글을 남겨보세요</Text>
        )}

        {roots.map((c) => (
          // 각 댓글이 어디에 그려졌는지 기억해 둔다. 답글을 달거나 새 댓글이 올라오면
          // 그 자리로 옮겨가야 한다(2026-08-01 조사).
          <View key={c.id} onLayout={(e) => { commentY.current[c.id] = e.nativeEvent.layout.y }}>
            <CommentRow
              c={c} mine={myCommentIds.includes(c.id)} styles={styles}
              onReply={() => { setReplyTo(c); setEditing(null); setDraft(''); setScrollToId(c.id) }}
              onEdit={() => { setEditing(c); setReplyTo(null); setDraft(c.content) }}
              onDelete={() => removeComment(c)}
              onReport={() => setReportTarget({ type: 'comment', id: c.id })}
            />
            {repliesOf(c.id).map((r) => (
              <CommentRow
                key={r.id} c={r} reply mine={myCommentIds.includes(r.id)} styles={styles}
                onLayout={(y) => { commentY.current[r.id] = (commentY.current[c.id] ?? 0) + y }}
                onEdit={() => { setEditing(r); setReplyTo(null); setDraft(r.content) }}
                onDelete={() => removeComment(r)}
                onReport={() => setReportTarget({ type: 'comment', id: r.id })}
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
              '지금 하는 일에 관련된' 컨트롤만 두고 시스템 기능을 겹쳐 만들지 말라고
              한다(2026-08-01 조사). */}
          {!!(replyTo || editing) && (
            <View style={styles.inputHint}>
              <Text style={styles.inputHintText}>
                {editing ? '댓글 수정 중' : `${replyTo?.nickname}님에게 답글`}
              </Text>
              <TouchableOpacity onPress={() => { setReplyTo(null); setEditing(null); setDraft('') }} hitSlop={8}>
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
              style={styles.commentInput}
              value={draft}
              onChangeText={setDraft}
              placeholder="댓글을 입력하세요"
              placeholderTextColor={colors.textTertiary}
              multiline
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

function CommentRow({
  c, reply = false, mine, styles, onReply, onEdit, onDelete, onReport, onLayout,
}: {
  c: BoardComment
  reply?: boolean
  mine: boolean
  styles: ReturnType<typeof makeStyles>
  onReply?: () => void
  onEdit: () => void
  onDelete: () => void
  onReport: () => void
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
            <TouchableOpacity onPress={onReport} hitSlop={8}>
              <Text style={styles.commentMetaAct}>신고</Text>
            </TouchableOpacity>
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

    commentHead: {
      fontSize: 14, fontWeight: '800', color: colors.textPrimary,
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
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
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    nickInput: {
      alignSelf: 'flex-start', minWidth: 110, fontSize: 13, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7, marginBottom: 6,
    },
    // 한 줄일 때 입력칸과 등록 버튼의 높이가 정확히 같아야 한다. 글자 크기가 달라
    // 눈대중 여백으로는 안 맞았다 — 둘 다 같은 minHeight 를 주고 가운데 정렬한다.
    commentInput: {
      flex: 1, minHeight: COMPOSER_H, maxHeight: 96,
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
