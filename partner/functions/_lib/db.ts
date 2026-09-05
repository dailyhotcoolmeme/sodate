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
