import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// 사용자 후기(UGC) 처리: 작성/수정/삭제/신고.
// 로그인 없음 → 익명 기기 시크릿(ownerToken)의 해시로 소유권 확인.
// 비속어 필터 + 기기당 업체별 1회 제한 + 신고(3회 자동숨김은 DB 트리거).

const BAD_WORDS = [
  '씨발', '시발', '씨빨', '개새끼', '새끼', '병신', '지랄', '좆', '섹스', '보지', '자지',
  '엠창', '느금', '니미', '창녀', '창놈', '걸레', '미친년', '미친놈', '썅', '스팸', '광고문의',
  'fuck', 'shit', 'bitch', 'asshole', 'porn', 'sex',
]

function containsBadWord(text: string): boolean {
  const t = text.toLowerCase().replace(/\s/g, '')
  return BAD_WORDS.some((w) => t.includes(w))
}

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
  const action = body.action as string

  try {
    // ── 작성 ──
    if (action === 'submit') {
      const { companyId, nickname, rating, content, ownerToken } = body
      if (!companyId || !ownerToken) return json({ error: '필수값 누락' }, 400)
      const nick = String(nickname ?? '').trim()
      const text = String(content ?? '').trim()
      const r = Number(rating)
      if (nick.length < 2 || nick.length > 20) return json({ error: '닉네임은 2~20자로 입력해주세요.' }, 400)
      if (!(r >= 1 && r <= 5)) return json({ error: '별점을 선택해주세요.' }, 400)
      if (text.length < 5 || text.length > 1000) return json({ error: '후기는 5~1000자로 입력해주세요.' }, 400)
      if (containsBadWord(nick) || containsBadWord(text)) return json({ error: '부적절한 표현이 포함되어 있습니다.' }, 400)

      const hash = await sha256(ownerToken)
      // 기기당 업체별 1회 제한
      const { data: dup } = await supabase
        .from('reviews')
        .select('id')
        .eq('company_id', companyId)
        .eq('owner_token', hash)
        .eq('source', 'user')
        .maybeSingle()
      if (dup) return json({ error: '이미 이 업체에 후기를 작성하셨어요.' }, 409)

      const { data, error } = await supabase
        .from('reviews')
        .insert({
          company_id: companyId,
          source: 'user',
          author_name: nick,
          content: text,
          rating: r,
          owner_token: hash,
          is_active: true,
          published_at: new Date().toISOString(),
        })
        .select('id, company_id, source, author_name, content, rating, published_at')
        .single()
      if (error) return json({ error: error.message }, 500)
      return json({ review: data })
    }

    // ── 수정 ──
    if (action === 'update') {
      const { reviewId, ownerToken, rating, content, nickname } = body
      if (!reviewId || !ownerToken) return json({ error: '필수값 누락' }, 400)
      const hash = await sha256(ownerToken)
      const { data: row } = await supabase.from('reviews').select('owner_token').eq('id', reviewId).maybeSingle()
      if (!row || row.owner_token !== hash) return json({ error: '본인 후기만 수정할 수 있어요.' }, 403)

      const patch: any = { updated_at: new Date().toISOString() }
      if (content != null) {
        const text = String(content).trim()
        if (text.length < 5 || text.length > 1000) return json({ error: '후기는 5~1000자로 입력해주세요.' }, 400)
        if (containsBadWord(text)) return json({ error: '부적절한 표현이 포함되어 있습니다.' }, 400)
        patch.content = text
      }
      if (rating != null) {
        const r = Number(rating)
        if (!(r >= 1 && r <= 5)) return json({ error: '별점을 확인해주세요.' }, 400)
        patch.rating = r
      }
      if (nickname != null) {
        const nick = String(nickname).trim()
        if (nick.length < 2 || nick.length > 20) return json({ error: '닉네임은 2~20자로 입력해주세요.' }, 400)
        if (containsBadWord(nick)) return json({ error: '부적절한 표현이 포함되어 있습니다.' }, 400)
        patch.author_name = nick
      }
      const { data, error } = await supabase
        .from('reviews').update(patch).eq('id', reviewId)
        .select('id, author_name, content, rating, published_at, updated_at').single()
      if (error) return json({ error: error.message }, 500)
      return json({ review: data })
    }

    // ── 삭제 ──
    if (action === 'delete') {
      const { reviewId, ownerToken } = body
      if (!reviewId || !ownerToken) return json({ error: '필수값 누락' }, 400)
      const hash = await sha256(ownerToken)
      const { data: row } = await supabase.from('reviews').select('owner_token').eq('id', reviewId).maybeSingle()
      if (!row || row.owner_token !== hash) return json({ error: '본인 후기만 삭제할 수 있어요.' }, 403)
      const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ── 신고 ──
    if (action === 'report') {
      const { reviewId, reporterToken, reason } = body
      if (!reviewId || !reporterToken) return json({ error: '필수값 누락' }, 400)
      const hash = await sha256(reporterToken)
      const { error } = await supabase
        .from('review_reports')
        .insert({ review_id: reviewId, reporter_token: hash, reason: reason ?? null })
      if (error) {
        if ((error as any).code === '23505') return json({ ok: true, already: true }) // 중복 신고
        return json({ error: error.message }, 500)
      }
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('reviews fn error:', e)
    return json({ error: String(e) }, 500)
  }
})
