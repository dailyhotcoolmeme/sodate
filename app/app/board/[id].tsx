import React, { useMemo, useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Keyboard,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { Image } from 'expo-image'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopBar from '@/components/TopBar'
import AppSpinner from '@/components/AppSpinner'
import ReportSheet from '@/components/ReportSheet'
import { useColors } from '@/hooks/useColors'
import type { AppColors } from '@/constants/colors'
import { useBoardPost } from '@/hooks/useBoard'
import {
  vote, deletePost, createComment, updateComment, deleteComment, markViewed,
} from '@/lib/board'
import { getLastNickname } from '@/lib/reviewIdentity'
import { wideContent } from '@/constants/layout'
import type { BoardComment } from '@/lib/board'

/** 글 상세 — 추천·비추, 댓글(대댓글 한 단계), 내 글이면 수정·삭제. */
export default function BoardPostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const { post, comments, myVote, isMine, myCommentIds, loading, refetch } = useBoardPost(id)
  const [voting, setVoting] = useState(false)
  const [nickname, setNickname] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<BoardComment | null>(null)
  const [editing, setEditing] = useState<BoardComment | null>(null)
  const [sending, setSending] = useState(false)
  const [reportTarget, setReportTarget] = useState<{ type: 'post' | 'comment' | 'image'; id: string } | null>(null)

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
    Keyboard.dismiss()
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TopBar showBack onLogoPress={() => router.replace('/board')} />

      <ScrollView
        contentContainerStyle={[wideContent, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.meta}>{post.nickname} · {formatFull(post.created_at)}</Text>
        </View>

        <Text style={styles.body}>{post.content}</Text>

        {!!post.image_urls?.length && (
          <View style={styles.images}>
            {post.image_urls.map((u) => (
              <View key={u} style={styles.imageWrap}>
                <Image source={{ uri: u }} style={styles.image} contentFit="cover" />
                {/* 신고가 쌓이면 이미지만 가린다. 가려진 이유가 보여야 작성자도 납득한다. */}
                {post.image_hidden && (
                  <View style={styles.imageMask}>
                    <Ionicons name="eye-off-outline" size={20} color="#fff" />
                    <Text style={styles.imageMaskText}>이미지 검수 중</Text>
                  </View>
                )}
              </View>
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

        <View style={styles.actions}>
          {isMine ? (
            <>
              <TouchableOpacity style={styles.act} onPress={() => router.push(`/board/write?id=${id}`)}>
                <Text style={styles.actText}>수정</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.act} onPress={handleDelete}>
                <Text style={[styles.actText, styles.actDanger]}>삭제</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.act} onPress={() => setReportTarget({ type: 'post', id })}>
                <Text style={styles.actText}>신고</Text>
              </TouchableOpacity>
              {!!post.image_urls?.length && !post.image_hidden && (
                <TouchableOpacity style={styles.act} onPress={() => setReportTarget({ type: 'image', id })}>
                  <Text style={styles.actText}>이미지 신고</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <Text style={styles.commentHead}>댓글 {post.comment_count}</Text>

        {roots.length === 0 && (
          <Text style={styles.noComment}>첫 댓글을 남겨보세요</Text>
        )}

        {roots.map((c) => (
          <View key={c.id}>
            <CommentRow
              c={c} mine={myCommentIds.includes(c.id)} styles={styles}
              onReply={() => { setReplyTo(c); setEditing(null); setDraft('') }}
              onEdit={() => { setEditing(c); setReplyTo(null); setDraft(c.content) }}
              onDelete={() => removeComment(c)}
              onReport={() => setReportTarget({ type: 'comment', id: c.id })}
            />
            {repliesOf(c.id).map((r) => (
              <CommentRow
                key={r.id} c={r} reply mine={myCommentIds.includes(r.id)} styles={styles}
                onEdit={() => { setEditing(r); setReplyTo(null); setDraft(r.content) }}
                onDelete={() => removeComment(r)}
                onReport={() => setReportTarget({ type: 'comment', id: r.id })}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* 댓글 입력 */}
      <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 8 }]}>
        {(replyTo || editing) && (
          <View style={styles.inputHint}>
            <Text style={styles.inputHintText}>
              {editing ? '댓글 수정 중' : `${replyTo?.nickname}님에게 답글`}
            </Text>
            <TouchableOpacity onPress={() => { setReplyTo(null); setEditing(null); setDraft('') }} hitSlop={8}>
              <Text style={styles.inputHintCancel}>취소</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.nickInput}
            value={nickname}
            onChangeText={setNickname}
            placeholder="닉네임"
            placeholderTextColor={colors.textTertiary}
            maxLength={20}
          />
          <TextInput
            style={styles.commentInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="댓글을 입력하세요"
            placeholderTextColor={colors.textTertiary}
            multiline
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
    </KeyboardAvoidingView>
  )
}

function CommentRow({
  c, reply = false, mine, styles, onReply, onEdit, onDelete, onReport,
}: {
  c: BoardComment
  reply?: boolean
  mine: boolean
  styles: ReturnType<typeof makeStyles>
  onReply?: () => void
  onEdit: () => void
  onDelete: () => void
  onReport: () => void
}) {
  return (
    <View style={[styles.comment, reply && styles.commentReply]}>
      <Text style={styles.commentMeta}>{c.nickname} · {formatFull(c.created_at)}</Text>
      <Text style={styles.commentBody}>{c.content}</Text>
      <View style={styles.commentActions}>
        {/* 답글에는 다시 답글을 달 수 없다(대댓글 한 단계) */}
        {!reply && onReply && (
          <TouchableOpacity onPress={onReply} hitSlop={6}>
            <Text style={styles.commentAct}>답글</Text>
          </TouchableOpacity>
        )}
        {mine ? (
          <>
            <TouchableOpacity onPress={onEdit} hitSlop={6}>
              <Text style={styles.commentAct}>수정</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDelete} hitSlop={6}>
              <Text style={[styles.commentAct, styles.commentActDanger]}>삭제</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={onReport} hitSlop={6}>
            <Text style={styles.commentAct}>신고</Text>
          </TouchableOpacity>
        )}
      </View>
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
    meta: { fontSize: 12, color: colors.textTertiary },

    body: { paddingHorizontal: 16, paddingVertical: 16, fontSize: 15, lineHeight: 23, color: colors.textPrimary },

    images: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
    imageWrap: { position: 'relative', borderRadius: 10, overflow: 'hidden' },
    image: { width: '100%', height: 220, backgroundColor: colors.surfaceHigh },
    imageMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    imageMaskText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    votes: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 14 },
    voteBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999,
      borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    },
    voteBtnOn: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
    voteText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    voteTextOn: { color: colors.primary, fontWeight: '800' },

    actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
    act: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border },
    actText: { fontSize: 12.5, color: colors.textSecondary },
    actDanger: { color: colors.error },

    commentHead: {
      fontSize: 14, fontWeight: '800', color: colors.textPrimary,
      paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
      borderTopWidth: 1, borderTopColor: colors.divider,
    },
    noComment: { fontSize: 13, color: colors.textTertiary, paddingHorizontal: 16, paddingVertical: 12 },

    comment: { paddingHorizontal: 16, paddingVertical: 11, gap: 4,
      borderTopWidth: 1, borderTopColor: colors.divider },
    commentReply: { paddingLeft: 34, backgroundColor: colors.surface },
    commentMeta: { fontSize: 11.5, color: colors.textTertiary },
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
      width: 78, fontSize: 13, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
    },
    commentInput: {
      flex: 1, maxHeight: 96, fontSize: 14, color: colors.textPrimary,
      backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    },
    sendBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.primary },
    sendBtnOff: { backgroundColor: colors.border },
    sendBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  })
}
