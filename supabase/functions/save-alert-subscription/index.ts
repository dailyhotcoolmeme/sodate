import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: {
    token: string
    regions?: string[]
    max_price?: number
    themes?: string[]
    hashtags?: string[]
    company_ids?: string[]
    notify_new?: boolean
    notify_deadline?: boolean
    /** true면 조건은 무시하고 이 push_token의 구독을 끈다(알림 해제 버튼) */
    unsubscribe?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { token, regions, max_price, themes, hashtags, company_ids, notify_new, notify_deadline, unsubscribe } = body
  if (!token) {
    return new Response(JSON.stringify({ error: 'token is required' }), { status: 400 })
  }

  // 토큰으로 push_token_id 조회
  const { data: pushToken, error: tokenError } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('token', token)
    .single()

  if (tokenError || !pushToken) {
    return new Response(JSON.stringify({ error: 'Push token not found. Register token first.' }), { status: 404 })
  }

  // 기존 구독 upsert (push_token_id 기준으로 1개만 유지)
  const { data, error } = await supabase
    .from('alert_subscriptions')
    .upsert(
      {
        push_token_id: pushToken.id,
        regions: regions ?? null,
        max_price: max_price ?? null,
        themes: themes ?? null,
        hashtags: hashtags ?? null,
        company_ids: company_ids ?? null,
        notify_new: notify_new ?? true,
        notify_deadline: notify_deadline ?? true,
        is_active: !unsubscribe,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'push_token_id' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('save-alert-subscription error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ id: data.id }), { status: 200 })
})
