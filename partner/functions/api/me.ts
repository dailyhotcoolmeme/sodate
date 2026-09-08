import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { currentAccountFilter, db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

interface CompanyRow {
  id: string
  name: string
  logo_url: string | null
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
      `select=id,name,logo_url,partner_tier&id=eq.${session.companyId}&limit=1`,
    )
  } catch {
    return json({ authenticated: false }, 500)
  }
  const company = rows[0]
  if (!company) return json({ authenticated: false }, 401)

  // 로그인 아이디(이메일)도 같이 내려준다 — 계정 설정 화면에서 "지금 내 아이디가
  // 뭔지"를 보여줘야 하는데, 그동안 화면 어디에도 안 나와서 업체가 알 수 없었다.
  let email = ''
  try {
    const filter = await currentAccountFilter(env, session)
    if (filter) {
      const accounts = await db.select<{ email: string }>(env, 'partner_accounts', `select=email&${filter}`)
      email = accounts[0]?.email ?? ''
    }
  } catch {
    // 이메일 표시는 부가 정보다 — 못 읽어도 로그인 상태 자체는 유지한다.
  }

  return json({
    authenticated: true,
    companyId: company.id,
    companyName: company.name,
    logoUrl: company.logo_url,
    email,
    tier: company.partner_tier ?? 'free',
  })
}
