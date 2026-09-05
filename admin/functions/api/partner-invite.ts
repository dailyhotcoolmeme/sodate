// 제휴 포털 초대 발급 — Partners.tsx 의 초대 버튼이 부른다.
// 1) partner_accounts 에 토큰을 심고(없으면 새로 만듦, 있으면 재발급) 2) Supabase
// Edge Function(send-partner-invite)에 메일 발송을 맡긴다. 실제 메일 발송은 오늘
// 복구한 Gmail(nodemailer) 인프라를 그대로 쓴다 — 새 이메일 계정이 필요 없다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  PARTNER_INVITE_SECRET: string
  // partner 포털의 실제 주소. 배포 후 CF Pages 환경변수로 넣는다.
  PARTNER_PORTAL_URL?: string
}

const INVITE_TTL_DAYS = 7

async function sb(env: Env, path: string, init: RequestInit & { preferReturn?: boolean } = {}) {
  const headers = new Headers(init.headers)
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('Prefer', init.preferReturn ? 'return=representation' : 'return=minimal')
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!authed) return json({ error: 'unauthorized' }, 401)

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.PARTNER_INVITE_SECRET) {
    return json({ error: 'server_not_configured' }, 500)
  }

  let body: { companyId?: string; email?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const companyId = String(body.companyId ?? '')
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!companyId || !email) return json({ error: 'missing_fields' }, 400)

  const companies = await sb(env, `companies?select=name&id=eq.${companyId}&limit=1`)
  const companyName = companies?.[0]?.name ?? '모잇 파트너'

  const token = crypto.randomUUID() + crypto.randomUUID()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString()

  const existing = await sb(env, `partner_accounts?select=id&company_id=eq.${companyId}&limit=1`)
  try {
    if (existing?.[0]) {
      await sb(env, `partner_accounts?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        body: JSON.stringify({ email, invite_token: token, invite_expires_at: expiresAt }),
      })
    } else {
      await sb(env, 'partner_accounts', {
        method: 'POST',
        body: JSON.stringify({
          company_id: companyId,
          email,
          password_hash: `unusable$${crypto.randomUUID()}`,
          invite_token: token,
          invite_expires_at: expiresAt,
        }),
      })
    }
  } catch (e) {
    return json({ error: 'db_error', detail: String(e).slice(0, 200) }, 500)
  }

  const portalBase = (env.PARTNER_PORTAL_URL || 'https://sodate-partner.pages.dev').replace(/\/+$/, '')
  const inviteUrl = `${portalBase}/accept-invite?token=${token}`

  const mailRes = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/send-partner-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'x-webhook-secret': env.PARTNER_INVITE_SECRET,
    },
    body: JSON.stringify({ email, companyName, inviteUrl }),
  })
  if (!mailRes.ok) {
    // 계정/토큰은 이미 심어졌으니 메일만 실패했다고 알려준다 — 오너가 링크를 직접 복사해 보낼 수 있게.
    return json({ ok: true, mailSent: false, inviteUrl }, 200)
  }

  return json({ ok: true, mailSent: true })
}
