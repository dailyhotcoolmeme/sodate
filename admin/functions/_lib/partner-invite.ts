// 제휴 포털 초대 발급 — 기존 업체를 초대할 때와 새 제휴처를 만들며 초대할 때
// 둘 다 같은 절차를 밟아야 해서 여기 한 곳에 뒀다.

export interface InviteEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  PARTNER_INVITE_SECRET: string
  PARTNER_PORTAL_URL?: string
}

const INVITE_TTL_DAYS = 7

export async function sb(
  env: InviteEnv,
  path: string,
  init: RequestInit & { preferReturn?: boolean } = {},
) {
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

export interface InviteResult {
  mailSent: boolean
  /** 메일이 안 나갔을 때 오너가 직접 전달할 수 있게 돌려준다. */
  inviteUrl: string
}

/**
 * partner_accounts 에 1회용 토큰을 심고 초대 메일을 보낸다.
 * 이미 계정이 있으면 토큰만 새로 발급한다(재초대).
 */
export async function issueInvite(
  env: InviteEnv,
  companyId: string,
  email: string,
  companyName: string,
): Promise<InviteResult> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString()

  const existing = await sb(env, `partner_accounts?select=id&company_id=eq.${companyId}&limit=1`)
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

  const portalBase = (env.PARTNER_PORTAL_URL || 'https://partner.moitbiz.com').replace(/\/+$/, '')
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

  return { mailSent: mailRes.ok, inviteUrl }
}
