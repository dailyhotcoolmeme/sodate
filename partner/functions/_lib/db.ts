// service_role 로 Supabase PostgREST를 직접 호출하는 얇은 헬퍼.
//
// ⚠️ admin의 /api/sb/[[path]] 같은 "세션만 확인하고 나머지는 그대로 통과"하는
//    범용 프록시를 여기서는 절대 재사용하면 안 된다. admin은 오너 1인 전용이라
//    전체 권한을 믿고 통과시켜도 되지만, 여기는 여러 업체 세션이 같은 서버를
//    나눠 쓴다 — 통과형 프록시를 두면 한 업체가 다른 업체의 company_id를 넣어
//    호출할 길이 열린다. 그래서 각 API 엔드포인트가 세션의 companyId를 직접
//    꺼내 쿼리 조건에 박아 넣는 함수만 여기서 제공한다.

export interface DbEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export class DbError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Supabase REST ${status}: ${body.slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

async function request(env: DbEnv, path: string, init: RequestInit & { preferReturn?: boolean } = {}) {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`
  const headers = new Headers(init.headers)
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('Prefer', init.preferReturn ? 'return=representation' : 'return=minimal')
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) throw new DbError(res.status, await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const db = {
  select: <T = unknown>(env: DbEnv, table: string, query: string): Promise<T[]> =>
    request(env, `${table}?${query}`, { method: 'GET' }),

  insert: <T = unknown>(env: DbEnv, table: string, row: Record<string, unknown>): Promise<T[]> =>
    request(env, table, { method: 'POST', body: JSON.stringify(row), preferReturn: true }),

  update: <T = unknown>(
    env: DbEnv,
    table: string,
    query: string,
    patch: Record<string, unknown>,
  ): Promise<T[]> =>
    request(env, `${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch), preferReturn: true }),

  delete: (env: DbEnv, table: string, query: string): Promise<null> =>
    request(env, `${table}?${query}`, { method: 'DELETE' }) as Promise<null>,
}

/**
 * 지금 로그인한 «사람» 을 찾는 조건.
 *
 * ⚠️ 회사만으로 찾으면 안 된다. 한 업체에 담당자가 여러 명일 수 있어서(2026-09-08)
 *    남의 계정이 잡힌다 — 계정 설정에 남의 이메일이 보이고 비밀번호도 남의 게 바뀐다.
 *    세션에 accountId 가 있으면 그걸로 콕 집는다. 예전에 발급된 세션에는 없을 수 있어
 *    그때만 회사로 찾되, 그 업체 계정이 «하나뿐일 때만» 인정한다.
 */
export async function currentAccountFilter(
  env: DbEnv,
  session: { companyId: string; accountId?: string },
  extra = '',
): Promise<string | null> {
  if (session.accountId) return `id=eq.${session.accountId}${extra}`
  const rows = await db.select<{ id: string }>(
    env,
    'partner_accounts',
    `select=id&company_id=eq.${session.companyId}&limit=2`,
  )
  if (rows.length !== 1) return null   // 여러 명이면 누구인지 알 수 없다 → 다시 로그인
  return `id=eq.${rows[0].id}${extra}`
}
