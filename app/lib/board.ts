import { supabase, type BoardPostRow, type BoardCommentRow, type BoardSettingsRow } from '@/lib/supabase'
import { getOrCreateToken, setLastNickname } from '@/lib/reviewIdentity'
import {
  addMyPostId, removeMyPostId, addMyCommentId, removeMyCommentId, setMyVote,
} from '@/lib/boardIdentity'

/**
 * board Edge Function 래퍼.
 * 서버가 검증·금칙어·도배방지·소유권확인을 담당하므로 여기서는 토큰 첨부와
 * 에러 문구 추출만 한다(후기 lib/reviews.ts 와 같은 구조).
 *
 * 조회는 함수를 거치지 않고 RLS로 직접 읽는다(hooks/useBoard.ts).
 */

export type BoardPost = BoardPostRow
export type BoardComment = BoardCommentRow
export type BoardSettings = BoardSettingsRow

/** 서버가 내려주는 에러 문구를 그대로 보여준다(사용자가 이해할 수 있게 쓰여 있다). */
async function extractError(error: any, data: any): Promise<string | null> {
  if (data && typeof data.error === 'string') return data.error
  if (error) {
    const ctx = error?.context
    try {
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body && typeof body.error === 'string') return body.error
      } else if (ctx && typeof ctx.text === 'function') {
        const t = await ctx.text()
        try {
          const j = JSON.parse(t)
          if (j && typeof j.error === 'string') return j.error
        } catch {
          if (t) return t
        }
      }
    } catch {
      // 파싱 실패 시 아래 기본 메시지로
    }
    return error.message || '처리 중 오류가 발생했습니다.'
  }
  return null
}

async function call(body: Record<string, unknown>): Promise<any | { error: string }> {
  const ownerToken = await getOrCreateToken()
  const { data, error } = await supabase.functions.invoke('board', {
    body: { ...body, ownerToken },
  })
  const msg = await extractError(error, data)
  if (msg) return { error: msg }
  return data ?? {}
}

// ── 글 ──
export async function createPost(p: {
  nickname: string
  title: string
  content: string
  imageUrls?: string[]
}): Promise<{ id: string } | { error: string }> {
  const r = await call({ action: 'createPost', ...p })
  if ('error' in r) return r
  // 닉네임은 후기와 같은 저장소를 쓴다 — 한 번 쓰면 다음부터 자동으로 채워진다.
  await setLastNickname(p.nickname)
  if (r.post?.id) await addMyPostId(r.post.id)
  return { id: r.post?.id }
}

/** 수정 화면 진입 시 글 불러오기. RLS(is_active만 허용)를 우회해 서버가 소유권만 확인하고
 *  내려준다 — 신고로 숨김된 내 글도 수정할 수 있어야 하기 때문(2026-08 애플 심사 대응). */
export async function getPostForEdit(postId: string): Promise<
  { post: { nickname: string; title: string; content: string; image_urls: string[] | null } } | { error: string }
> {
  const r = await call({ action: 'getPost', postId })
  return 'error' in r ? r : { post: r.post }
}

export async function updatePost(p: {
  postId: string
  title?: string
  content?: string
  imageUrls?: string[]
}): Promise<{ ok: true } | { error: string }> {
  const r = await call({ action: 'updatePost', ...p })
  return 'error' in r ? r : { ok: true }
}

export async function deletePost(postId: string): Promise<{ ok: true } | { error: string }> {
  const r = await call({ action: 'deletePost', postId })
  if ('error' in r) return r
  await removeMyPostId(postId)
  return { ok: true }
}

// ── 댓글 ──
export async function createComment(p: {
  postId: string
  parentId?: string | null
  nickname: string
  content: string
}): Promise<{ id: string } | { error: string }> {
  const r = await call({ action: 'createComment', ...p })
  if ('error' in r) return r
  await setLastNickname(p.nickname)
  if (r.comment?.id) await addMyCommentId(r.comment.id)
  return { id: r.comment?.id }
}

export async function updateComment(
  commentId: string,
  content: string
): Promise<{ ok: true } | { error: string }> {
  const r = await call({ action: 'updateComment', commentId, content })
  return 'error' in r ? r : { ok: true }
}

export async function deleteComment(commentId: string): Promise<{ ok: true } | { error: string }> {
  const r = await call({ action: 'deleteComment', commentId })
  if ('error' in r) return r
  await removeMyCommentId(commentId)
  return { ok: true }
}

// ── 추천 · 비추 ──
/** 같은 것을 다시 누르면 취소된다. 서버가 최종 상태(my)를 돌려준다. */
export async function vote(
  postId: string,
  value: 1 | -1
): Promise<{ my: 0 | 1 | -1 } | { error: string }> {
  const r = await call({ action: 'vote', postId, value })
  if ('error' in r) return r
  const my = (r.my ?? 0) as 0 | 1 | -1
  await setMyVote(postId, my)
  return { my }
}

// ── 신고 ──
export async function report(
  targetType: 'post' | 'comment' | 'image',
  targetId: string,
  reason?: string
): Promise<{ ok: true; already?: boolean } | { error: string }> {
  const r = await call({ action: 'report', targetType, targetId, reason })
  return 'error' in r ? r : { ok: true, already: r.already === true }
}

// ── 조회수 (화면에는 감춰뒀지만 값은 쌓아둔다) ──
export async function markViewed(postId: string): Promise<void> {
  try {
    await call({ action: 'view', postId })
  } catch {
    // 조회수는 실패해도 사용자에게 알릴 일이 아니다
  }
}
