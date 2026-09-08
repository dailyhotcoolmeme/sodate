// 업체별 제휴 포털 계정 관리. Partners.tsx 의 «제휴 포털 로그인 계정» 칸이 쓴다.
//
// ⚠️(2026-09-08) 예전엔 «업체당 계정 하나»를 전제로 limit=1 로 한 건만 읽고,
//    초대할 때 그 행을 덮어썼다. 그래서 같은 업체에 두 번째 담당자를 초대하면
//    첫 번째 담당자의 로그인이 조용히 끊겼다(오너 지적). 이제 목록으로 다룬다.
//
//  GET    ?companyId=…            → 그 업체의 계정 «목록»
//  PATCH  {accountId, status?, email?} → 한 계정의 상태·이메일 수정
//  DELETE ?accountId=…            → 한 계정 삭제
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('Prefer', 'return=representation')
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.text()
    throw Object.assign(new Error(body.slice(0, 200)), { status: res.status })
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

async function requireOwner(request: Request, env: Env) {
  return verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401)

  const companyId = new URL(request.url).searchParams.get('companyId') ?? ''
  if (!companyId) return json({ error: 'missing_company_id' }, 400)

  const rows = await sb(
    env,
    `partner_accounts?select=id,email,status,invite_token,last_login_at,created_at` +
      `&company_id=eq.${companyId}&order=created_at.asc`,
  )
  return json({
    accounts: (rows ?? []).map((r: any) => ({
      id: r.id,
      email: r.email,
      status: r.status,
      pending: !!r.invite_token, // 초대는 갔지만 아직 비밀번호를 안 정한 상태
      lastLoginAt: r.last_login_at,
    })),
  })
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401)

  let body: { accountId?: string; status?: string; email?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const accountId = String(body.accountId ?? '')
  if (!accountId) return json({ error: 'missing_account_id' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) {
    if (!['active', 'disabled'].includes(String(body.status))) return json({ error: 'bad_status' }, 400)
    patch.status = body.status
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400)
    patch.email = email
  }
  if (!Object.keys(patch).length) return json({ error: 'empty_patch' }, 400)

  try {
    const rows = await sb(env, `partner_accounts?id=eq.${accountId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!rows?.length) return json({ error: 'not_found' }, 404)
    return json({ ok: true })
  } catch (e: any) {
    // email 에 unique 제약이 있다 — 다른 업체가 이미 쓰는 주소면 여기서 걸린다.
    if (e?.status === 409) return json({ error: 'email_taken' }, 409)
    return json({ error: 'save_failed', detail: String(e).slice(0, 200) }, 500)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await requireOwner(request, env))) return json({ error: 'unauthorized' }, 401)

  const accountId = new URL(request.url).searchParams.get('accountId') ?? ''
  if (!accountId) return json({ error: 'missing_account_id' }, 400)

  // 지우기 전에 실제로 있는지 확인한다 — DELETE 는 «없음»과 «지웠음»을 구분 못 해서,
  // 화면에 정확한 결과를 돌려주려면 한 번 더 봐야 한다.
  const found = await sb(env, `partner_accounts?select=id&id=eq.${accountId}&limit=1`)
  if (!found?.length) return json({ error: 'not_found' }, 404)

  await sb(env, `partner_accounts?id=eq.${accountId}`, { method: 'DELETE' })
  return json({ ok: true })
}
