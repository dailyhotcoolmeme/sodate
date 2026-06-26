import { createClient } from '@supabase/supabase-js'

// service_role 키는 클라이언트 번들에 두지 않는다.
// 모든 요청은 동일 출처 Pages Function(/api/sb)이 세션 쿠키를 검증한 뒤
// 서버에서 service_role 로 Supabase 에 프록시한다. (apikey 'proxy' 는 서버가 덮어씀)
const PROXY_URL = `${window.location.origin}/api/sb`

export const supabase = createClient(PROXY_URL, 'proxy', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
  },
})
