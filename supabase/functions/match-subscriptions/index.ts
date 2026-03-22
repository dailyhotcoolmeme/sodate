import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { record } = await req.json()  // DB Webhook payload
  const event = record
  const isDeadlineReminder = event._notification_type === 'deadline_reminder'

  // D-1 중복 방지: 오늘 이미 발송한 이벤트는 스킵
  if (isDeadlineReminder && event.id) {
    const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const { data: ev } = await supabase
      .from('events')
      .select('deadline_notified_date')
      .eq('id', event.id)
      .single()
    if (ev?.deadline_notified_date === todayKST) {
      return new Response(JSON.stringify({ queued: 0, skipped: 'already_sent_today' }), { status: 200 })
    }
  }

  // 이벤트 조건에 맞는 활성 구독자 조회
  const query = supabase
    .from('alert_subscriptions')
    .select('*, push_tokens(token)')
    .eq('is_active', true)

  const { data: subscriptions } = await (
    isDeadlineReminder
      ? query.eq('notify_deadline', true)
      : query.eq('notify_new', true)
  )

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
  }

  // 서울 구 단위 목록 (DB에서 "서울"로 저장된 이벤트가 실제론 서울 내 어딘가)
  const SEOUL_DISTRICTS = ['강남', '역삼', '홍대', '신촌', '을지로', '이태원', '성수', '잠실', '동작', '종로']

  function regionMatches(subRegions: string[], eventRegion: string): boolean {
    if (subRegions.includes(eventRegion)) return true
    // 이벤트가 광역 "서울"이고, 구독자가 서울 구 단위를 하나라도 선택했으면 매칭
    if (eventRegion === '서울' && subRegions.some(r => SEOUL_DISTRICTS.includes(r))) return true
    return false
  }

  // 조건 필터링
  const matchedTokens: string[] = []
  for (const sub of subscriptions) {
    const token = sub.push_tokens?.token
    if (!token) continue

    // 지역 조건
    if (sub.regions && sub.regions.length > 0) {
      // 영어 region값 정규화 (예: "seoul" → "서울")
      const normalized = sub.regions.map((r: string) =>
        r.toLowerCase() === 'seoul' ? '서울' : r
      )
      if (!regionMatches(normalized, event.location_region)) continue
    }

    // 가격 조건
    if (sub.max_price) {
      const price = event.price_male || event.price_female || 0
      if (price > sub.max_price) continue
    }

    // 테마 조건
    if (sub.themes && sub.themes.length > 0) {
      const hasTheme = event.theme?.some((t: string) => sub.themes.includes(t))
      if (!hasTheme) continue
    }

    // 특정 업체 조건
    if (sub.company_ids && sub.company_ids.length > 0) {
      if (!sub.company_ids.includes(event.company_id)) continue
    }

    matchedTokens.push(token)
  }

  if (matchedTokens.length === 0) {
    return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
  }

  // 회사명 조회
  const { data: company } = await supabase
    .from('companies')
    .select('name')
    .eq('id', event.company_id)
    .single()

  // Queue에 적재 (배치: 최대 500개씩)
  const BATCH_SIZE = 500
  let queued = 0
  for (let i = 0; i < matchedTokens.length; i += BATCH_SIZE) {
    const batch = matchedTokens.slice(i, i + BATCH_SIZE)
    await supabase.rpc('pgmq_send', {
      queue_name: 'push_notifications',
      msg: {
        type: isDeadlineReminder ? 'deadline_reminder' : 'new_event',
        event_id: event.id,
        event_title: event.title,
        event_date: event.event_date,
        location_region: event.location_region,
        company_name: company?.name || '',
        source_url: event.source_url,
        target_tokens: batch,
      }
    })
    queued += batch.length
  }

  // D-1 알림 발송 기록 (중복 방지용)
  if (isDeadlineReminder && event.id && queued > 0) {
    const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    await supabase.from('events').update({ deadline_notified_date: todayKST }).eq('id', event.id)
  }

  return new Response(JSON.stringify({ queued }), { status: 200 })
})
