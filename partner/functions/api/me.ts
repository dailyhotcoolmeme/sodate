import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

interface CompanyRow {
  id: string
  name: string
  partner_tier: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ authenticated: false }, 401)

  let rows: CompanyRow[]
  try {
    rows = await db.select<CompanyRow>(
      env,
      'companies',
      `select=id,name,partner_tier&id=eq.${session.companyId}&limit=1`,
    )
  } catch {
    return json({ authenticated: false }, 500)
  }
  const company = rows[0]
  if (!company) return json({ authenticated: false }, 401)

  return json({
    authenticated: true,
    companyId: company.id,
    companyName: company.name,
    tier: company.partner_tier ?? 'free',
  })
}
