// 인증된 Supabase REST 프록시.
// 클라이언트의 supabase-js 는 이 경로(/api/sb)를 Supabase URL 로 사용한다.
// 여기서 세션 쿠키를 검증한 뒤, service_role 키(서버 시크릿)를 주입해
// 실제 Supabase 로 그대로 전달한다. service_role 키는 클라이언트에 절대 노출되지 않는다.

import { verifySession, getCookie, COOKIE, json } from '../../_lib/session'

interface Env {
  SESSION_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

// supabase-js 가 사용하는 경로만 허용 (rest/v1 = PostgREST)
const ALLOWED_PREFIXES = ['rest/v1/']

const FORWARD_REQ_HEADERS = [
  'content-type',
  'prefer',
  'accept',
  'accept-profile',
  'content-profile',
  'range',
  'range-unit',
  'x-client-info',
]

const FORWARD_RES_HEADERS = ['content-type', 'content-range', 'range-unit', 'prefer']

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const authed = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!authed) return json({ error: 'unauthorized' }, 401)

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'server_not_configured' }, 500)
  }

  const raw = params.path
  const segments = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
  if (!ALLOWED_PREFIXES.some((p) => segments.startsWith(p))) {
    return json({ error: 'forbidden_path' }, 403)
  }

  const search = new URL(request.url).search
  const target = `${env.SUPABASE_URL.replace(/\/$/, '')}/${segments}${search}`

  const headers = new Headers()
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  for (const h of FORWARD_REQ_HEADERS) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }

  const init: RequestInit = { method: request.method, headers }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text()
  }

  const upstream = await fetch(target, init)

  const resHeaders = new Headers()
  for (const h of FORWARD_RES_HEADERS) {
    const v = upstream.headers.get(h)
    if (v) resHeaders.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
}
