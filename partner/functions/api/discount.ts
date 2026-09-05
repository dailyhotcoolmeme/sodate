// 제휴 할인 문구 — companies.partner_benefit 을 자기 회사 것만 읽고 쓴다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)
  try {
    const rows = await db.select<{ partner_benefit: string | null }>(
      env,
      'companies',
      `select=partner_benefit&id=eq.${session.companyId}&limit=1`,
    )
    return json({ benefit: rows[0]?.partner_benefit ?? '' })
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)

  let body: { benefit?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const benefit = String(body.benefit ?? '').trim().slice(0, 200)

  try {
    await db.update(env, 'companies', `id=eq.${session.companyId}`, { partner_benefit: benefit || null })
    return json({ ok: true, benefit })
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}
