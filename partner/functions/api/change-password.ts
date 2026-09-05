import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { verifyPassword, hashPassword } from '../_lib/password'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

const MIN_PASSWORD_LEN = 8

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)

  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const current = String(body.currentPassword ?? '')
  const next = String(body.newPassword ?? '')
  if (next.length < MIN_PASSWORD_LEN) {
    return json({ error: 'password_too_short', min: MIN_PASSWORD_LEN }, 400)
  }

  const rows = await db.select<{ id: string; password_hash: string }>(
    env,
    'partner_accounts',
    `select=id,password_hash&company_id=eq.${session.companyId}&status=eq.active&limit=1`,
  )
  const account = rows[0]
  if (!account) return json({ error: 'unauthorized' }, 401)

  const ok = await verifyPassword(current, account.password_hash)
  if (!ok) return json({ error: 'current_password_incorrect' }, 401)

  const newHash = await hashPassword(next)
  await db.update(env, 'partner_accounts', `id=eq.${account.id}`, { password_hash: newHash })
  return json({ ok: true })
}
