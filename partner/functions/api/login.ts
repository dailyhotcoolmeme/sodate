import { signSession, sessionCookie, json } from '../_lib/session'
import { verifyPassword } from '../_lib/password'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

interface PartnerAccountRow {
  id: string
  company_id: string
  email: string
  password_hash: string
  status: string
}

// admin/functions/api/login.ts 와 같은 이유로 같은 완화 방식을 쓴다: 무차별 대입에
// 항상 최소 지연을 걸고, 짧게라도 연속 실패하면 그 IP를 몇 분 잠근다.
const failCounts = new Map<string, { n: number; until: number }>()
const LOCK_AFTER = 5
const LOCK_MS = 5 * 60 * 1000
const MIN_FAIL_DELAY_MS = 700

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'server_not_configured' }, 500)
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const now = Date.now()
  const rec = failCounts.get(ip)
  if (rec && rec.until > now) {
    return json({ error: 'too_many_attempts', retry_after_sec: Math.ceil((rec.until - now) / 1000) }, 429)
  }

  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  const fail = async () => {
    const n = (rec?.n ?? 0) + 1
    failCounts.set(ip, { n, until: n >= LOCK_AFTER ? now + LOCK_MS : 0 })
    await new Promise((r) => setTimeout(r, Math.min(MIN_FAIL_DELAY_MS + (n - 1) * 400, 3000)))
    return json({ error: 'invalid_credentials' }, 401)
  }

  if (!email || !password) return fail()

  let rows: PartnerAccountRow[]
  try {
    rows = await db.select<PartnerAccountRow>(
      env,
      'partner_accounts',
      `select=id,company_id,email,password_hash,status&email=eq.${encodeURIComponent(email)}&limit=1`,
    )
  } catch {
    return json({ error: 'server_error' }, 500)
  }
  const account = rows[0]
  if (!account) return fail()

  const ok = await verifyPassword(password, account.password_hash)
  if (!ok) return fail()

  // 비번은 맞아도 오너가 제휴를 정지시켰으면 로그인 자체를 막는다. safeEqual로
  // 'active' 문자열을 비교할 이유는 없다(비밀값이 아니다) — 그냥 값 비교.
  if (account.status !== 'active') {
    return json({ error: 'account_disabled' }, 403)
  }

  failCounts.delete(ip)
  db.update(env, 'partner_accounts', `id=eq.${account.id}`, {
    last_login_at: new Date().toISOString(),
  }).catch(() => {})

  const token = await signSession(env.SESSION_SECRET, account.company_id)
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) })
}
