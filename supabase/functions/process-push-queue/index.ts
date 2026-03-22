import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Queue에서 메시지 읽기 (최대 10개씩)
  const { data: messages } = await supabase.rpc('pgmq_read', {
    queue_name: 'push_notifications',
    vt: 30,   // 30초 visibility timeout
    qty: 10
  })

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  let totalSent = 0
  const processedMsgIds: number[] = []

  for (const msg of messages) {
    const payload = msg.message
    const tokens: string[] = payload.target_tokens || []

    // Expo Push API 형식으로 변환
    const notifications = tokens.map((token: string) => ({
      to: token,
      title: payload.type === 'new_event'
        ? `소개팅모아 - ${payload.location_region} 새 일정`
        : `소개팅모아 - ${payload.location_region} 마감 임박`,
      body: payload.event_title,
      data: {
        event_id: payload.event_id,
        source_url: payload.source_url,
      },
      sound: 'default',
      badge: 1,
    }))

    // Expo Push API 호출 (100개씩 배치)
    const BATCH = 100
    for (let i = 0; i < notifications.length; i += BATCH) {
      const batch = notifications.slice(i, i + BATCH)
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      })
      if (res.ok) totalSent += batch.length
    }

    processedMsgIds.push(msg.msg_id)
  }

  // 처리 완료된 메시지 Queue에서 삭제
  for (const msgId of processedMsgIds) {
    await supabase.rpc('pgmq_delete', {
      queue_name: 'push_notifications',
      msg_id: msgId
    })
  }

  return new Response(JSON.stringify({ sent: totalSent }), { status: 200 })
})
