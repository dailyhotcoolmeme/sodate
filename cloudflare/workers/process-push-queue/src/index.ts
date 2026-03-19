export interface Env {
  PUSH_NOTIFICATIONS_QUEUE: Queue
}

interface PushMessage {
  type: 'new_event' | 'deadline_reminder'
  event_id: string
  event_title: string
  event_date: string
  location_region: string
  company_name: string
  source_url: string
  target_tokens: string[]
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export default {
  async queue(batch: MessageBatch<PushMessage>, _env: Env): Promise<void> {
    for (const message of batch.messages) {
      const payload = message.body
      const tokens = payload.target_tokens ?? []

      if (tokens.length === 0) {
        message.ack()
        continue
      }

      const notifications = tokens.map((token) => ({
        to: token,
        title:
          payload.type === 'new_event'
            ? `새 소개팅 - ${payload.location_region}`
            : `마감 임박 - ${payload.location_region}`,
        body: payload.event_title,
        data: {
          event_id: payload.event_id,
          source_url: payload.source_url,
        },
        sound: 'default',
        badge: 1,
      }))

      // Expo Push API: 최대 100개씩 배치 전송
      const BATCH = 100
      for (let i = 0; i < notifications.length; i += BATCH) {
        const notifBatch = notifications.slice(i, i + BATCH)
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notifBatch),
        })
        if (!res.ok) {
          console.error('Expo Push API 오류:', await res.text())
        }
      }

      message.ack()
    }
  },
}
