export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  PUSH_NOTIFICATIONS_QUEUE: Queue
}

interface EventRecord {
  id: string
  company_id: string
  title: string
  event_date: string
  location_region: string
  price_male?: number
  price_female?: number
  theme?: string[]
  source_url: string
}

interface WebhookPayload {
  type: string
  record: EventRecord
}

interface Subscription {
  regions?: string[]
  max_price?: number
  themes?: string[]
  company_ids?: string[]
  push_tokens?: { token: string }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const payload: WebhookPayload = await req.json()

    // INSERT 이벤트만 처리
    if (payload.type !== 'INSERT') {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 })
    }

    const event = payload.record

    // 활성 구독자 전체 조회
    const subsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/alert_subscriptions?is_active=eq.true&notify_new=eq.true&select=*,push_tokens(token)`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    )

    if (!subsRes.ok) {
      const body = await subsRes.text()
      return new Response(JSON.stringify({ error: `구독자 조회 실패: ${body}` }), { status: 500 })
    }

    const subscriptions: Subscription[] = await subsRes.json()

    // 업체명 조회
    const companyRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/companies?id=eq.${event.company_id}&select=name`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    )
    const companies: { name: string }[] = await companyRes.json()
    const companyName = companies[0]?.name ?? ''

    // 조건 매칭
    const matchedTokens: string[] = []
    for (const sub of subscriptions) {
      const token = sub.push_tokens?.token
      if (!token) continue

      if (sub.regions && sub.regions.length > 0) {
        if (!sub.regions.includes(event.location_region)) continue
      }

      if (sub.max_price) {
        const price = event.price_male ?? event.price_female ?? 0
        if (price > sub.max_price) continue
      }

      if (sub.themes && sub.themes.length > 0) {
        const hasTheme = event.theme?.some((t) => sub.themes!.includes(t))
        if (!hasTheme) continue
      }

      if (sub.company_ids && sub.company_ids.length > 0) {
        if (!sub.company_ids.includes(event.company_id)) continue
      }

      matchedTokens.push(token)
    }

    if (matchedTokens.length === 0) {
      return new Response(JSON.stringify({ queued: 0 }), { status: 200 })
    }

    // Cloudflare Queue에 배치 발송 (500개씩)
    const BATCH_SIZE = 500
    let queued = 0
    for (let i = 0; i < matchedTokens.length; i += BATCH_SIZE) {
      const batch = matchedTokens.slice(i, i + BATCH_SIZE)
      await env.PUSH_NOTIFICATIONS_QUEUE.send({
        type: 'new_event',
        event_id: event.id,
        event_title: event.title,
        event_date: event.event_date,
        location_region: event.location_region,
        company_name: companyName,
        source_url: event.source_url,
        target_tokens: batch,
      })
      queued += batch.length
    }

    return new Response(JSON.stringify({ queued }), { status: 200 })
  },
}
