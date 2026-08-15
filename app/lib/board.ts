import { supabase, type BoardPostRow, type BoardCommentRow, type BoardSettingsRow, type BoardTagRow } from '@/lib/supabase'
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
export type BoardTag = BoardTagRow

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
  /** 유튜브 링크(최대 3개) — 서버가 유튜브만 허용, 아니면 에러 문구를 돌려준다. */
  linkUrls?: string[]
  /** 말머리 id. 안 고르면 undefined — 서버는 "선택 안 함"으로 처리한다. */
  tagId?: string | null
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
  {
    post: {
      nickname: string; title: string; content: string; image_urls: string[] | null
      link_urls: string[] | null
      tag_id: string | null
      /** 지금은 비활성화됐을 수 있는 말머리도 수정 화면엔 '현재 선택'으로 보여줘야 해서 같이 온다 */
      tag_label: string | null
    }
  } | { error: string }
> {
  const r = await call({ action: 'getPost', postId })
  return 'error' in r ? r : { post: r.post }
}

export async function updatePost(p: {
  postId: string
  title?: string
  content?: string
  imageUrls?: string[]
  linkUrls?: string[]
  /** 'tagId' 키 자체를 안 보내면 말머리를 그대로 두고, null 을 보내면 없앤다. */
  tagId?: string | null
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
  /** 비밀 댓글 — 글쓴이·본인·(대댓글이면) 원 댓글 작성자만 볼 수 있다 */
  isSecret?: boolean
}): Promise<{ id: string } | { error: string }> {
  const r = await call({ action: 'createComment', ...p })
  if ('error' in r) return r
  await setLastNickname(p.nickname)
  if (r.comment?.id) await addMyCommentId(r.comment.id)
  return { id: r.comment?.id }
}

/**
 * 비밀 댓글 본문 가져오기. 앱은 secret_content 를 직접 읽을 권한이 없어서
 * 서버가 기기 해시로 자격을 확인한 뒤 볼 수 있는 것만 내려준다.
 * 글 단위(postId)나 댓글 id 목록(commentIds) 중 하나로 요청한다.
 * 실패하면 빈 객체 — 본문이 안 보일 뿐 화면은 정상 동작해야 한다.
 */
export async function fetchSecretComments(
  p: { postId: string } | { commentIds: string[] }
): Promise<Record<string, string>> {
  const r = await call({ action: 'secretComments', ...p })
  if ('error' in r || !r?.contents) return {}
  return r.contents as Record<string, string>
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
  /** 'content' = 첨부(사진+유튜브 링크 등) 전체 — 예전엔 'image' 전용이었다가
   *  2026-08-13 일반화(supabase/migrations/20260813f_board_content_report_unify.sql). */
  targetType: 'post' | 'comment' | 'content',
  targetId: string,
  reason?: string
): Promise<{ ok: true; already?: boolean } | { error: string }> {
  const r = await call({ action: 'report', targetType, targetId, reason })
  return 'error' in r ? r : { ok: true, already: r.already === true }
}

// ── 조회수 ──
export async function markViewed(postId: string): Promise<void> {
  try {
    await call({ action: 'view', postId })
  } catch {
    // 조회수는 실패해도 사용자에게 알릴 일이 아니다
  }
}

/** 글 id로 0~2^32 범위의 값을 만든다(FNV-1a). 같은 글이면 항상 같은 값. */
function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 기본 가산 범위. 이 폭을 댓글 수만큼 잘게 나눠 쓴다.
 * 처음엔 500~1000 이었는데 실제 글에 적용해보니 최대 1,547 까지 올라가 초기 커뮤니티
 * 규모에 비해 부풀려 보였다 → 절반 수준으로 낮췄다(오너 확인 2026-08-15).
 */
const VIEW_BASE_MIN = 300
const VIEW_BASE_MAX = 600
/**
 * 기본 가산을 몇 구간으로 쪼갤지 — 댓글이 이보다 많으면 전부 최상위 구간을 쓴다.
 * 10 이었을 땐 댓글 10개를 넘는 순간 구간이 포화돼 그룹 간 여유가 43점까지 줄었고,
 * 아래 지터(±30, 폭 60)를 감당하지 못해 순서가 뒤집혔다 → 30 으로 넓혔다.
 */
const VIEW_BANDS = 30
/**
 * 같은 댓글 수끼리 숫자가 겹쳐 보이지 않게 흩뿌리는 폭(±). 구간 폭만으로는 값이
 * 9~27가지뿐이라 글이 몇 개만 쌓여도 610/610, 714/714 처럼 똑같은 수가 나와
 * 조작한 티가 났다(오너 지적 2026-08-15).
 * ⚠️ 이 폭의 2배(60)가 그룹 간 여유보다 작아야 순서가 안 뒤집힌다.
 */
const VIEW_JITTER = 30
/**
 * 댓글 1개당 가산. ⚠️ 여기를 글마다 랜덤으로 두면 안 된다 — 기본 가산 구간 폭(약 27)보다
 * 편차가 커지는 순간 "댓글 많은 글이 더 많이 읽힌다"는 순서가 뒤집힌다(실측: 댓글 6개 글
 * 1,203 < 댓글 5개 글 1,626). 고정해야 순서가 항상 지켜진다.
 */
const VIEW_PER_COMMENT = 70

/** 가산분이 목표치까지 다 차오르는 데 걸리는 시간(분). */
const RAMP_MINUTES = 60
/** 램프를 몇 조각으로 쪼갤지 — 30초마다 한 칸씩 오른다. */
const RAMP_STEPS = 120
const RAMP_TOTAL_MS = RAMP_MINUTES * 60 * 1000
const RAMP_STEP_MS = RAMP_TOTAL_MS / RAMP_STEPS

/**
 * 글이 올라온 뒤 지금까지 가산분을 몇 % 채웠는지(0~1).
 *
 * 글을 쓰자마자 수백이 찍히면 거짓말이 바로 티가 나서(오너 지적 2026-08-15),
 * 1시간에 걸쳐 서서히 차오르게 한다. 갓 쓴 글은 실제 조회수만 보인다(조회 1~3).
 *
 * 스텝마다 가중치를 따로 뽑아 더하므로 **증가폭이 매번 다르다**(일정한 규칙으로
 * 오르면 그것대로 티가 난다). 가중치는 글 id + 스텝 번호로 정해져서, 같은 글을
 * 같은 시각에 보면 언제나 같은 숫자다 — 새로고침해도 안 튄다.
 * 가중치가 항상 양수라 값이 줄어드는 일은 없다.
 *
 * 초반 스텝일수록 가중치를 크게 준다. 갓 올라온 글이 목록 맨 위에 있을 때 조회가
 * 몰리고, 밀려나면서 완만해지는 실제 게시판 패턴에 맞춘 것(오너 선택 2026-08-15).
 */
function rampRatio(id: string, createdAt?: string | null): number {
  if (!createdAt) return 1
  const started = Date.parse(createdAt)
  if (!Number.isFinite(started)) return 1
  // 기기 시계가 서버보다 빠르면 경과가 음수로 나온다 — 그때는 아직 안 오른 것으로 본다.
  const elapsed = Date.now() - started
  if (elapsed >= RAMP_TOTAL_MS) return 1
  if (elapsed <= 0) return 0

  const done = Math.floor(elapsed / RAMP_STEP_MS)
  let total = 0
  let acc = 0
  for (let i = 0; i < RAMP_STEPS; i++) {
    const front = ((RAMP_STEPS - i) / RAMP_STEPS) * 2 + 0.3   // 2.3배 → 0.3배
    const w = (1 + (seedOf(`${id}#${i}`) % 9)) * front
    total += w
    if (i < done) acc += w
  }
  return total > 0 ? acc / total : 1
}

/**
 * 글 상세에 보여줄 조회수. **실제 수치가 아니다 — 초기 부양용 가산이 섞여 있다.**
 *
 * 서비스 초기라 실제 수치(한 자리~두 자리)가 그대로 보이면 휑해 보여서 가산한다
 * (오너 지시 2026-08-15). 기본 300~600 에 댓글 수만큼 더 얹어, 댓글이 많은 글이
 * 반드시 더 많이 읽힌 것처럼 보이게 한다.
 *
 * 기본 가산은 300~600 안에서 **댓글 수에 따라 구간을 나눠** 뽑는다. 그래서 댓글이
 * 많을수록 기본값도 커지고, 거기에 댓글당 고정 가산이 더해져 순서가 뒤집히지 않는다.
 * 구간 안에서는 글 id로 랜덤이고 ±30 지터까지 더해 총합이 불규칙해 보인다.
 * 가산분은 글이 올라온 뒤 1시간에 걸쳐 서서히 차오른다(rampRatio).
 *
 * ⚠️ DB(view_count)에는 진짜 조회수만 쌓인다 — 가산은 화면에서만 한다.
 * ⚠️ 난수를 그때그때 뽑으면 새로고침할 때마다 조회수가 출렁여 바로 들킨다.
 *    글 id에서 값을 만들어(seedOf) 같은 글은 언제 봐도 같은 숫자가 나오게 한다.
 *
 * 📌 **나중에 이 가산을 걷어낼 때**: 이 함수 본문을
 *    `return post.view_count ?? 0` 한 줄로 바꾸면 끝난다. DB가 이미 진짜 값이라
 *    데이터 정리나 마이그레이션이 필요 없다. 판단 기준과 배경은
 *    `docs/view_count_inflation.md` 참고.
 */
export function displayViewCount(post: {
  id: string
  view_count?: number | null
  comment_count?: number | null
  created_at?: string | null
}): number {
  const seed = seedOf(post.id)
  const comments = Math.max(0, post.comment_count ?? 0)
  const band = Math.min(comments, VIEW_BANDS)
  const span = Math.floor((VIEW_BASE_MAX - VIEW_BASE_MIN) / (VIEW_BANDS + 1))
  const base = VIEW_BASE_MIN + band * span + (seed % (span + 1))
  // 지터는 seed의 다른 자리를 써서 base와 겹치지 않게 뽑는다 — 같은 자리를 쓰면
  // 둘이 같이 움직여 흩어지는 효과가 반감된다.
  const jitter = ((seed >>> 16) % (VIEW_JITTER * 2 + 1)) - VIEW_JITTER
  const inflation = base + comments * VIEW_PER_COMMENT + jitter
  // 실제 조회수는 램프와 무관하게 그대로 더한다 — 갓 쓴 글은 이 값만 보인다.
  return (post.view_count ?? 0) + Math.round(inflation * rampRatio(post.id, post.created_at))
}
