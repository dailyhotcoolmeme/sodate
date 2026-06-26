import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ok = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  return json({ authenticated: ok }, ok ? 200 : 401)
}
