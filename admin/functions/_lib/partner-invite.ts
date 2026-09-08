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

  // ⚠️(2026-09-08) 예전엔 «그 업체의 아무 계정»을 찾아 덮어썼다. 그래서 같은 업체에
  //    두 번째 담당자를 초대하면 첫 번째 담당자의 이메일이 바뀌어 로그인이 끊겼다.
  //    이제 «같은 이메일»이 있을 때만 재초대로 보고, 아니면 새 담당자로 추가한다.
  const same = await sb(
    env,
    `partner_accounts?select=id&company_id=eq.${companyId}&email=eq.${encodeURIComponent(email)}&limit=1`,
  )
  if (same?.[0]) {
    // 재초대 — 토큰만 새로 발급한다(비밀번호는 건드리지 않는다).
    await sb(env, `partner_accounts?id=eq.${same[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ invite_token: token, invite_expires_at: expiresAt }),
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
