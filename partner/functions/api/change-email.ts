// 로그인 아이디(이메일) 변경. 업체 담당자가 바뀌면 오너에게 재초대를 부탁하지
// 않고 업체가 스스로 넘길 수 있어야 한다(오너 확정, 2026-09-05).
//
// 비밀번호를 한 번 더 확인받고 바꾼다 — 로그인한 화면을 잠깐 두고 자리를 비운
// 사이에 아이디가 바뀌어 계정을 통째로 뺏기는 일을 막기 위함이다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { verifyPassword } from '../_lib/password'
import { db, DbError, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

// 완전한 RFC 검사는 하지 않는다 — 오타로 못 쓰는 주소를 넣는 걸 막는 최소한이다.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)

  let body: { password?: string; newEmail?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const password = String(body.password ?? '')
  const newEmail = String(body.newEmail ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(newEmail)) return json({ error: 'invalid_email' }, 400)

  const rows = await db.select<{ id: string; email: string; password_hash: string }>(
    env,
    'partner_accounts',
    `select=id,email,password_hash&company_id=eq.${session.companyId}&status=eq.active&limit=1`,
  )
  const account = rows[0]
  if (!account) return json({ error: 'unauthorized' }, 401)

  if (account.email === newEmail) return json({ ok: true, email: newEmail })

  const ok = await verifyPassword(password, account.password_hash)
  if (!ok) return json({ error: 'password_incorrect' }, 401)

  try {
    await db.update(env, 'partner_accounts', `id=eq.${account.id}`, { email: newEmail })
  } catch (e) {
    // email 컬럼에 unique 제약이 걸려 있다 — 다른 업체가 이미 쓰는 주소면 여기서 걸린다.
    if (e instanceof DbError && e.status === 409) {
      return json({ error: 'email_taken' }, 409)
    }
    return json({ error: 'server_error' }, 500)
  }

  return json({ ok: true, email: newEmail })
}
