import { signSession, sessionCookie, json } from '../_lib/session'
import { hashPassword } from '../_lib/password'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

interface InviteRow {
  id: string
  company_id: string
  invite_expires_at: string | null
}

const MIN_PASSWORD_LEN = 8

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SESSION_SECRET || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'server_not_configured' }, 500)
  }

  let body: { token?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const token = String(body.token ?? '')
  const password = String(body.password ?? '')
  if (!token) return json({ error: 'missing_token' }, 400)
  if (password.length < MIN_PASSWORD_LEN) {
    return json({ error: 'password_too_short', min: MIN_PASSWORD_LEN }, 400)
  }

  let rows: InviteRow[]
  try {
    rows = await db.select<InviteRow>(
      env,
      'partner_accounts',
      `select=id,company_id,invite_expires_at&invite_token=eq.${encodeURIComponent(token)}&limit=1`,
    )
  } catch {
    return json({ error: 'server_error' }, 500)
  }
  const invite = rows[0]
  if (!invite) return json({ error: 'invalid_token' }, 404)

  if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() < Date.now()) {
    return json({ error: 'expired_token' }, 410)
  }

  const passwordHash = await hashPassword(password)
  try {
    // invite_token=null 로 지워서 이 링크를 다시 못 쓰게 한다(1회용).
    await db.update(env, 'partner_accounts', `id=eq.${invite.id}`, {
      password_hash: passwordHash,
      invite_token: null,
      invite_expires_at: null,
      // ⚠️ status 를 여기서 'active' 로 되돌리지 않는다. 오너가 «로그인 막기» 해둔 계정이
      //    초대 링크만 누르면 다시 열려버렸다(2026-09-08 실측). 여는 건 오너만 한다.
    })
  } catch {
    return json({ error: 'server_error' }, 500)
  }

  const session = await signSession(env.SESSION_SECRET, invite.company_id, undefined, invite.id)
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(session) })
}
