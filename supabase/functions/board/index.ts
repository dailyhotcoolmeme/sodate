import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 게시판(docs/BOARD_SPEC.md) — 글·댓글 작성/수정/삭제, 추천·비추, 신고.
// 로그인 없음 → 익명 기기 시크릿(ownerToken)의 해시로 소유권을 확인한다(후기와 동일).
// 조회는 앱이 RLS로 직접 읽으므로 여기서는 쓰기만 다룬다.

// ── 금칙어 ───────────────────────────────────────────────────────────────
// 후기용 목록을 그대로 쓰면 익명 자유게시판에는 약하다. 두 가지가 빠져 있었다.
//   1) 초성·변형 — 'ㅅㅂ', '시1발', 'ㅄ' 을 못 잡는다
//   2) 홍보 글 — 오픈채팅 링크·전화번호를 전혀 못 막는다
// 그래서 정규화 단계를 두고, 게시판용 목록과 패턴을 더했다.

const BAD_WORDS = [
  // 후기와 공통
  '씨발', '시발', '씨빨', '개새끼', '새끼', '병신', '지랄', '좆', '섹스', '보지', '자지',
  '엠창', '느금', '니미', '창녀', '창놈', '걸레', '미친년', '미친놈', '썅',
  'fuck', 'shit', 'bitch', 'asshole', 'porn', 'sex',
  // 게시판 보강 — 욕설·비하
  '개년', '개놈', '썅년', '썅놈', '쌍놈', '쌍년', '호로', '지랄맞',
  '한남충', '한녀', '김치녀', '된장녀', '맘충', '급식충', '틀딱', '틀니',
  '장애인새', '병신같', '정신병자', '자살해', '죽어라', '뒤져라',
  // 성적 표현
  '자위', '야동', 'av배우', '조건만남', '출장안마', '성매매', '유흥알바',
  '가슴사진', '몸매사진', '노출사진', '19금', '섹파', '원나잇',
]

// 초성만 쓴 욕설. 일반 문장에 우연히 나오기 어려운 조합만 골랐다.
const CHOSUNG_WORDS = ['ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅁㅊ', 'ㅈㄹ', 'ㄷㅊ', 'ㅈㄴ', 'ㅗ']

// 홍보·연락처 유도. 게시판에서 가장 먼저 들어오는 종류다.
const SPAM_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /open\.?kakao\.com|오픈\s*채팅|오픈\s*카톡|오카방/i, why: '오픈채팅 링크·안내' },
  { re: /t\.me\/|텔레\s*그램|telegram/i, why: '텔레그램 안내' },
  { re: /\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b/, why: '전화번호' },
  { re: /카톡\s*(아이디|id)|카카오톡\s*(아이디|id)/i, why: '카톡 아이디 안내' },
  { re: /(입금|계좌|송금)\s*(부탁|요청|주세요)/, why: '금전 요구' },
]

// 링크는 '외부면 무조건 차단'이 아니라 허용 목록으로 본다. 사용자가 다녀온 모임 링크나
// 후기 블로그를 공유하는 건 정상이고, 그걸 막으면 게시판이 안 돌아간다.
const ALLOWED_HOSTS = [
  // 후기·공유가 자연스러운 곳
  'naver.com', 'daum.net', 'instagram.com', 'youtube.com', 'youtu.be',
  // 우리가 다루는 업체(모임 링크 공유)
  'frip.co.kr', 'munto.kr', 'modparty.co.kr', 'emotional0ranges.com',
  'talkblossom.co.kr', 'lovecasting.co.kr', 'secretsalon.co.kr',
  '2yeonsi.com', 'lovecommunity.imweb.me', 'yeonin.co.kr',
  // 우리 서비스
  'ourmine.co.kr',
]

/** 허용 목록 밖 링크가 있으면 그 호스트를 돌려준다. */
function foreignLink(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || []
  for (const u of urls) {
    const host = (u.match(/^https?:\/\/([^/:?#]+)/i)?.[1] || '').toLowerCase().replace(/^www\./, '')
    if (!host) continue
    if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return host
  }
  return null
}

/**
 * 변형을 걷어낸다. '시 발' '시!발' 'ㅅ.ㅂ' 이 모두 같은 문자열이 되게.
 * 숫자·영문을 사이에 끼우는 수법('시1발', '병１신')은 바꿔치기가 아니라 통째로
 * 지운 판본을 따로 만들어 함께 검사한다. 바꿔치기만 하면 '시ㅣ발'이 되어 안 걸린다.
 */
function stripNoise(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[\s​]/g, '')                        // 공백·제로폭
    .replace(/[.,!?~\-_*^'"`|\\/()[\]{}]/g, '')     // 흔한 끼워넣기 기호
}

/** 한글 사이에 낀 숫자·영문까지 지운 판본(변형 잡이용) */
function stripFillers(text: string): string {
  return stripNoise(text).replace(/[0-9０-９a-z]/g, '')
}

export function moderate(text: string): string | null {
  const plain = stripNoise(text)
  const nofill = stripFillers(text)
  for (const w of BAD_WORDS) {
    if (plain.includes(stripNoise(w))) return '부적절한 표현이 포함되어 있습니다.'
    // ⚠️ 영문 금칙어는 필러 제거판이 빈 문자열이 된다('fuck' → ''). 빈 문자열은
    //    어떤 텍스트에나 포함되므로 그대로 두면 모든 글이 차단된다(2026-07-31 실제 발생).
    const f = stripFillers(w)
    if (f && nofill.includes(f)) return '부적절한 표현이 포함되어 있습니다.'
  }
  for (const w of CHOSUNG_WORDS) {
    if (plain.includes(w) || nofill.includes(w)) return '부적절한 표현이 포함되어 있습니다.'
  }
  // 홍보 패턴·링크는 원문 그대로 본다(정규화하면 링크가 깨진다)
  for (const { re, why } of SPAM_PATTERNS) {
    if (re.test(text)) return `홍보성 내용은 올릴 수 없습니다(${why}).`
  }
  const host = foreignLink(text)
  if (host) return `허용되지 않은 링크입니다(${host}).`
  return null
}

// ── 공통 ─────────────────────────────────────────────────────────────────
const TITLE_MAX = 60
const CONTENT_MAX = 10000
const COMMENT_MAX = 1000
const NICK_MIN = 2
const NICK_MAX = 20

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  const action = String(body.action ?? '')
  const token = String(body.ownerToken ?? '')
  if (!token) return json({ error: '필수값 누락' }, 400)
  const hash = await sha256(token)

  // 차단된 기기는 쓰기 자체를 막는다(애플 1.2 요건)
  const { data: blocked } = await supabase
    .from('board_blocks').select('owner_token').eq('owner_token', hash).maybeSingle()
  if (blocked) return json({ error: '이용이 제한된 사용자입니다.' }, 403)

  const { data: cfg } = await supabase.from('board_settings').select('*').eq('id', true).single()

  /** 도배 방지 — 같은 기기가 직전에 쓴 시각과의 간격을 본다. */
  async function tooSoon(table: 'board_posts' | 'board_comments', seconds: number) {
    const { data } = await supabase
      .from(table).select('created_at').eq('owner_token', hash)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!data) return false
    const gap = (Date.now() - new Date(data.created_at).getTime()) / 1000
    return gap < seconds
  }

  /** 내 것인지 확인. 아니면 에러 문구를 돌려준다. */
  async function mine(table: 'board_posts' | 'board_comments', id: string) {
    const { data } = await supabase.from(table).select('owner_token').eq('id', id).maybeSingle()
    if (!data) return '글을 찾을 수 없습니다.'
    if (data.owner_token !== hash) return '본인이 쓴 것만 수정·삭제할 수 있어요.'
    return null
  }

  try {
    // ── 글 작성 ──
    if (action === 'createPost') {
      const nick = String(body.nickname ?? '').trim()
      const title = String(body.title ?? '').trim()
      const content = String(body.content ?? '').trim()
      const images: string[] = Array.isArray(body.imageUrls) ? body.imageUrls.slice(0, 5) : []

      if (nick.length < NICK_MIN || nick.length > NICK_MAX)
        return json({ error: `닉네임은 ${NICK_MIN}~${NICK_MAX}자로 입력해주세요.` }, 400)
      if (!title || title.length > TITLE_MAX)
        return json({ error: `제목은 1~${TITLE_MAX}자로 입력해주세요.` }, 400)
      if (!content || content.length > CONTENT_MAX)
        return json({ error: `본문은 1~${CONTENT_MAX}자로 입력해주세요.` }, 400)
      const bad = moderate(`${nick} ${title} ${content}`)
      if (bad) return json({ error: bad }, 400)
      if (await tooSoon('board_posts', cfg?.post_cooldown_seconds ?? 30))
        return json({ error: '잠시 후에 다시 올려주세요.' }, 429)

      const { data, error } = await supabase.from('board_posts').insert({
        nickname: nick, title, content, owner_token: hash,
        image_urls: images.length ? images : null,
      }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      return json({ post: data })
    }

    // ── 글 수정 ──
    if (action === 'updatePost') {
      const id = String(body.postId ?? '')
      const err = await mine('board_posts', id)
      if (err) return json({ error: err }, 403)

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.title != null) {
        const title = String(body.title).trim()
        if (!title || title.length > TITLE_MAX)
          return json({ error: `제목은 1~${TITLE_MAX}자로 입력해주세요.` }, 400)
        patch.title = title
      }
      if (body.content != null) {
        const content = String(body.content).trim()
        if (!content || content.length > CONTENT_MAX)
          return json({ error: `본문은 1~${CONTENT_MAX}자로 입력해주세요.` }, 400)
        patch.content = content
      }
      if (Array.isArray(body.imageUrls)) patch.image_urls = body.imageUrls.slice(0, 5)
      const bad = moderate(`${patch.title ?? ''} ${patch.content ?? ''}`)
      if (bad) return json({ error: bad }, 400)

      const { error } = await supabase.from('board_posts').update(patch).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 글 삭제 ──
    if (action === 'deletePost') {
      const id = String(body.postId ?? '')
      const err = await mine('board_posts', id)
      if (err) return json({ error: err }, 403)
      const { error } = await supabase.from('board_posts').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 댓글 작성 ──
    if (action === 'createComment') {
      const postId = String(body.postId ?? '')
      const parentId = body.parentId ? String(body.parentId) : null
      const nick = String(body.nickname ?? '').trim()
      const content = String(body.content ?? '').trim()

      if (nick.length < NICK_MIN || nick.length > NICK_MAX)
        return json({ error: `닉네임은 ${NICK_MIN}~${NICK_MAX}자로 입력해주세요.` }, 400)
      if (!content || content.length > COMMENT_MAX)
        return json({ error: `댓글은 1~${COMMENT_MAX}자로 입력해주세요.` }, 400)
      const bad = moderate(`${nick} ${content}`)
      if (bad) return json({ error: bad }, 400)
      if (await tooSoon('board_comments', cfg?.comment_cooldown_seconds ?? 10))
        return json({ error: '잠시 후에 다시 남겨주세요.' }, 429)

      const { data, error } = await supabase.from('board_comments').insert({
        post_id: postId, parent_id: parentId, nickname: nick, content, owner_token: hash,
      }).select('id').single()
      // 대댓글의 대댓글은 DB 트리거가 막는다 → 사용자 문구로 바꿔 전달
      if (error) {
        if (error.message.includes('답글을 달 수 없습니다'))
          return json({ error: '답글에는 다시 답글을 달 수 없습니다.' }, 400)
        return json({ error: error.message }, 500)
      }
      return json({ comment: data })
    }

    // ── 댓글 수정 ──
    if (action === 'updateComment') {
      const id = String(body.commentId ?? '')
      const err = await mine('board_comments', id)
      if (err) return json({ error: err }, 403)
      const content = String(body.content ?? '').trim()
      if (!content || content.length > COMMENT_MAX)
        return json({ error: `댓글은 1~${COMMENT_MAX}자로 입력해주세요.` }, 400)
      const bad = moderate(content)
      if (bad) return json({ error: bad }, 400)
      const { error } = await supabase.from('board_comments')
        .update({ content, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 댓글 삭제 ──
    if (action === 'deleteComment') {
      const id = String(body.commentId ?? '')
      const err = await mine('board_comments', id)
      if (err) return json({ error: err }, 403)
      const { error } = await supabase.from('board_comments').delete().eq('id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 추천 · 비추 (같은 것을 다시 누르면 취소) ──
    if (action === 'vote') {
      const postId = String(body.postId ?? '')
      const value = Number(body.value)
      if (value !== 1 && value !== -1) return json({ error: '잘못된 요청입니다.' }, 400)

      const { data: prev } = await supabase.from('board_votes')
        .select('value').eq('post_id', postId).eq('owner_token', hash).maybeSingle()

      if (prev && prev.value === value) {
        await supabase.from('board_votes').delete()
          .eq('post_id', postId).eq('owner_token', hash)
        return json({ ok: true, my: 0 })
      }
      const { error } = await supabase.from('board_votes')
        .upsert({ post_id: postId, owner_token: hash, value }, { onConflict: 'post_id,owner_token' })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, my: value })
    }

    // ── 신고 (글 / 댓글 / 이미지) ──
    if (action === 'report') {
      const targetType = String(body.targetType ?? '')
      const targetId = String(body.targetId ?? '')
      if (!['post', 'comment', 'image'].includes(targetType))
        return json({ error: '잘못된 요청입니다.' }, 400)
      const { error } = await supabase.from('board_reports').insert({
        target_type: targetType, target_id: targetId,
        reporter_token: hash, reason: body.reason ?? null,
      })
      if (error) {
        if ((error as any).code === '23505') return json({ ok: true, already: true })
        return json({ error: error.message }, 500)
      }
      return json({ ok: true })
    }

    // ── 조회수 (화면에는 감춰두지만 값은 쌓아둔다) ──
    if (action === 'view') {
      const postId = String(body.postId ?? '')
      await supabase.rpc('increment_board_view', { p_id: postId })
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('board fn error:', e)
    return json({ error: String(e) }, 500)
  }
})
