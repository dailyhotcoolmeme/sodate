import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// ⚠️ iOS 간헐 멈춤 방지(파킨온 동일 증상): supabase-js(PostgREST) fetch가 응답 없이 hang하면
// 이를 await하는 화면의 finally(로딩/스피너 해제)에 영영 도달 못 해 오버레이가 안 내려가고
// 터치·스크롤이 굳는다. AbortController로 전역 20초 타임아웃을 걸어 hang을 reject로 전환 →
// 모든 화면의 finally가 반드시 실행되게 한다. (realtime=웹소켓·미디어=R2라 영향 없음. 상위 signal도 존중)
const FETCH_TIMEOUT_MS = 20000
const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const upstream = (init as RequestInit | undefined)?.signal
  if (upstream) {
    if (upstream.aborted) controller.abort()
    else upstream.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return fetch(input as any, { ...(init as any), signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
})

export type EventRow = Database['public']['Tables']['events']['Row']
export type CompanyRow = Database['public']['Tables']['companies']['Row']
export type ReviewRow = Database['public']['Tables']['reviews']['Row']
export type EventWithCompany = EventRow & {
  companies: CompanyRow | null
  /** 상세 설명 이미지(해석된 결과). 있으면 이미지로 표시, 없으면 설명 섹션 숨김 */
  descImages?: string[]
}
