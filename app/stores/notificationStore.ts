import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { getCachedPushToken } from '@/lib/pushToken'

// 톱바 종 배지(안 읽은 알림 수)를 앱 전역에서 반응형으로 공유.
// 어디서든 setUnread/refreshUnread 하면 모든 톱바 배지가 즉시 갱신됨.
interface NotificationState {
  unread: number
  setUnread: (n: number) => void
  refreshUnread: () => Promise<void>
  markReadOnServer: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  refreshUnread: async () => {
    const token = await getCachedPushToken()
    if (!token) return
    const { data } = await (supabase.rpc as any)('get_unread_notification_count', { p_token: token })
    if (typeof data === 'number') set({ unread: data })
  },
  // 알림 탭/목록 진입 시: 서버에서 모두 읽음 처리 + 배지 0
  markReadOnServer: async () => {
    set({ unread: 0 })
    const token = await getCachedPushToken()
    if (!token) return
    await (supabase.rpc as any)('mark_notifications_read', { p_token: token })
  },
}))
