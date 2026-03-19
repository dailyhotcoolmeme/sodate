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

  let body: { token: string; platform: 'ios' | 'android' }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 })
  }

  const { token, platform } = body
  if (!token) {
    return new Response(JSON.stringify({ error: 'token is required' }), { status: 400 })
  }
  if (platform && !['ios', 'android'].includes(platform)) {
    return new Response(JSON.stringify({ error: 'platform must be ios or android' }), { status: 400 })
  }

  // upsert: 같은 토큰이 있으면 last_seen_at 갱신
  const { data, error } = await supabase
    .from('push_tokens')
    .upsert(
      { token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('register-push-token error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  return new Response(JSON.stringify({ id: data.id }), { status: 200 })
})
