// 이미 목록에 있는 업체에 제휴 포털 초대(또는 재초대)를 보낸다.
// 새 제휴처를 «만들면서» 초대하는 건 partner-company.ts 쪽이다.
// 실제 발급·메일 절차는 두 곳이 같아야 하므로 _lib/partner-invite.ts 에 모아 뒀다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { issueInvite, sb, type InviteEnv } from '../_lib/partner-invite'

interface Env extends InviteEnv {
  SESSION_SECRET: string
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
  const companyName = companies?.[0]?.name ?? '모잇 제휴처'

  try {
    const result = await issueInvite(env, companyId, email, companyName)
    if (!result.mailSent) {
      // 계정·토큰은 이미 심어졌으니 메일만 실패했다고 알려준다 — 오너가 링크를 직접 전달할 수 있게.
      return json({ ok: true, mailSent: false, inviteUrl: result.inviteUrl }, 200)
    }
    return json({ ok: true, mailSent: true })
  } catch (e) {
    return json({ error: 'db_error', detail: String(e).slice(0, 200) }, 500)
  }
}
