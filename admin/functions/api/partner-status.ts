// 업체별 포털 계정 상태 조회(GET) / 정지·재개(PATCH). Partners.tsx 가 켠 업체마다
// 부른다 — 초대했는지, 아직 가입 전인지, 정지시켰는지를 화면에 보여주기 위함.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('Prefer', 'return=representation')
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!authed) return json({ error: 'unauthorized' }, 401)

  const companyId = new URL(request.url).searchParams.get('companyId') ?? ''
  if (!companyId) return json({ error: 'missing_company_id' }, 400)

  const rows = await sb(
    env,
    `partner_accounts?select=email,status,invite_token,last_login_at&company_id=eq.${companyId}&limit=1`,
  )
  const row = rows?.[0]
  if (!row) return json({ account: null })
  return json({
    account: {
      email: row.email,
      status: row.status,
      pending: !!row.invite_token, // 초대는 갔지만 아직 비번을 안 정한 상태
      lastLoginAt: row.last_login_at,
    },
  })
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!authed) return json({ error: 'unauthorized' }, 401)

  let body: { companyId?: string; status?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const companyId = String(body.companyId ?? '')
  const status = String(body.status ?? '')
  if (!companyId || !['active', 'disabled'].includes(status)) {
    return json({ error: 'bad_request' }, 400)
  }

  await sb(env, `partner_accounts?company_id=eq.${companyId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return json({ ok: true })
}
