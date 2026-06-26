import { signSession, sessionCookie, json, TTL_SEC } from '../_lib/session'

interface Env {
  ADMIN_ID: string
  ADMIN_PW: string
  SESSION_SECRET: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_ID || !env.ADMIN_PW || !env.SESSION_SECRET) {
    return json({ error: 'server_not_configured' }, 500)
  }

  let body: { id?: string; pw?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const id = String(body.id ?? '')
  const pw = String(body.pw ?? '')

  if (id !== env.ADMIN_ID || pw !== env.ADMIN_PW) {
    return json({ error: 'invalid_credentials' }, 401)
  }

  const token = await signSession(env.SESSION_SECRET)
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, TTL_SEC) })
}
