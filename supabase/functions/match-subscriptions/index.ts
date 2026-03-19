import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { record } = await req.json()  // DB Webhook payload
  const event = record

  // 이벤트 조건에 맞는 활성 구독자 조회
  const { data: subscriptions } = await supabase
    .from('alert_subscriptions')
    .select('*, push_tokens(token)')
    .eq('is_active', true)
    .eq('notify_new', true)

  if (!subscriptions || subscriptions.length === 0) {
    return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
  }

  // 조건 필터링
  const matchedTokens: string[] = []
  for (const sub of subscriptions) {
    const token = sub.push_tokens?.token
    if (!token) continue

    // 지역 조건
    if (sub.regions && sub.regions.length > 0) {
      if (!sub.regions.includes(event.location_region)) continue
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
        type: 'new_event',
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

  return new Response(JSON.stringify({ queued }), { status: 200 })
})
