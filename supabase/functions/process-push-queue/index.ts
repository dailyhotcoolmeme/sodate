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

  // 발송 직전 구독 상태를 다시 조회한다. target_tokens는 match-subscriptions가 큐에 넣던
  // "그 순간"의 대상자 스냅샷이라, 그 뒤 사용자가 알림을 끄더라도 메시지엔 그대로 남아있다.
  // 큐가 밀리면(2026-08-03 실측: 최대 34시간·13건 적체) 이미 꺼둔 사용자에게도 발송되는
  // 사고로 이어진다 — enqueue 시점이 아니라 발송 시점 기준으로 다시 걸러야 한다.
  // ⚠️ 1000행 상한에 걸리면 그 밖의 토큰은 아래 subByToken 에 없어서 sub?.is_active 가
  //    undefined 가 되고, 정상 구독자인데 필터에서 탈락해 푸시를 못 받는다. 나눠 받는다.
  //    (2026-08-13 감사 — match-subscriptions 와 같은 계열의 문제)
  const SUB_PAGE = 1000
  const allSubs: any[] = []
  for (let from = 0; ; from += SUB_PAGE) {
    const { data } = await supabase
      .from('alert_subscriptions')
      .select('is_active, notify_new, notify_deadline, push_tokens(token)')
      .range(from, from + SUB_PAGE - 1)
    if (data) allSubs.push(...data)
    if (!data || data.length < SUB_PAGE) break
  }
  const subByToken = new Map<string, { is_active: boolean; notify_new: boolean; notify_deadline: boolean }>()
  for (const s of allSubs ?? []) {
    const token = (s as { push_tokens?: { token?: string } }).push_tokens?.token
    if (token) subByToken.set(token, s as { is_active: boolean; notify_new: boolean; notify_deadline: boolean })
  }

  let totalSent = 0
  const processedMsgIds: number[] = []

  for (const msg of messages) {
    const payload = msg.message
    const requestedTokens: string[] = payload.target_tokens || []
    const tokens = requestedTokens.filter((t) => {
      const sub = subByToken.get(t)
      if (!sub?.is_active) return false
      return payload.type === 'deadline_reminder' ? sub.notify_deadline : sub.notify_new
    })

    const title = payload.type === 'new_event'
      ? `ㅅㄱㅌㅁㅇ - ${payload.location_region} 새 일정`
      : `ㅅㄱㅌㅁㅇ - ${payload.location_region} 마감 임박`

    // Expo Push API 형식으로 변환.
    // ⚠️ 잠금화면 프라이버시: 본문(내용)은 넣지 않고 '제목만' 표시("…새 일정").
    //    소개팅/파티 내용이 타인에게 노출되지 않도록. (앱 내 알림 내역엔 내용 유지)
    const notifications = tokens.map((token: string) => ({
      to: token,
      title,
      data: {
        event_id: payload.event_id,
        source_url: payload.source_url,
      },
      sound: 'default',
      badge: 1,
    }))

    // 알림 내역(인앱) 로그 — 토큰별 1행
    if (tokens.length > 0) {
      const rows = tokens.map((token: string) => ({
        token,
        event_id: payload.event_id ?? null,
        type: payload.type ?? 'new_event',
        title,
        body: payload.event_title ?? '',
        location_region: payload.location_region ?? null,
        company_name: payload.company_name ?? null,
        source_url: payload.source_url ?? null,
      }))
      await supabase.from('notification_logs').insert(rows)
    }

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
