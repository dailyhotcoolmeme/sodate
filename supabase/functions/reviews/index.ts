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
      const { companyId, nickname, rating, content, ownerToken, gender, eventId } = body
      if (!companyId || !ownerToken) return json({ error: '필수값 누락' }, 400)
      const nick = String(nickname ?? '').trim()
      const text = String(content ?? '').trim()
      const r = Number(rating)
      if (nick.length < 2 || nick.length > 20) return json({ error: '닉네임은 2~20자로 입력해주세요.' }, 400)
      if (!(r >= 1 && r <= 5)) return json({ error: '별점을 선택해주세요.' }, 400)
      if (text.length < 5 || text.length > 1000) return json({ error: '후기는 5~1000자로 입력해주세요.' }, 400)
      if (containsBadWord(nick) || containsBadWord(text)) return json({ error: '부적절한 표현이 포함되어 있습니다.' }, 400)
      if (gender !== 'male' && gender !== 'female') return json({ error: '성별을 선택해주세요.' }, 400)

      // 모임명은 클라이언트가 보낸 문자열을 믿지 않고 서버가 일정에서 직접 읽는다.
      // 지난 일정은 정리되면서 삭제되므로, event_id 연결과 별개로 제목 사본을 남긴다.
      let eventTitle: string | null = null
      if (eventId) {
        const { data: ev } = await supabase
          .from('events').select('id, company_id, title').eq('id', eventId).maybeSingle()
        if (!ev) return json({ error: '일정을 찾을 수 없어요. 목록을 새로고침해주세요.' }, 400)
        if (ev.company_id !== companyId) return json({ error: '일정과 업체가 맞지 않아요.' }, 400)
        eventTitle = ev.title ?? null
      }

      // 소유권 확인/수정·삭제용 해시(작성 제한 없음 — 한 기기가 같은 업체에 여러 후기 가능)
      const hash = await sha256(ownerToken)

      const { data, error } = await supabase
        .from('reviews')
        .insert({
          company_id: companyId,
          source: 'user',
          author_name: nick,
          content: text,
          rating: r,
          gender,
          event_id: eventId ?? null,
          event_title: eventTitle,
          owner_token: hash,
          is_active: true,
          published_at: new Date().toISOString(),
        })
        .select('id, company_id, source, author_name, content, rating, gender, event_id, event_title, published_at')
        .single()
      if (error) return json({ error: error.message }, 500)
      return json({ review: data })
    }

    // ── 수정 ──
    if (action === 'update') {
      const { reviewId, ownerToken, rating, content, nickname, gender } = body
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
      if (gender != null) {
        if (gender !== 'male' && gender !== 'female') return json({ error: '성별을 선택해주세요.' }, 400)
        patch.gender = gender
      }
      // 모임(event_id/event_title)은 수정 대상이 아니다 — 작성 당시 다녀온 모임이 바뀔 수는 없다.
      const { data, error } = await supabase
        .from('reviews').update(patch).eq('id', reviewId)
        .select('id, author_name, content, rating, gender, event_id, event_title, published_at, updated_at').single()
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
