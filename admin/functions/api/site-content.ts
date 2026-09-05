// moitbiz.com 공개 페이지의 문구 읽기/저장. 지금은 /partner 한 장이지만,
// key 로 구분해 두어 나중에 다른 페이지가 늘어도 이 엔드포인트를 그대로 쓴다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

// 아무 key나 만들 수 있게 두면 오타 하나로 «저장은 됐는데 사이트엔 안 나오는» 상태가 된다.
const ALLOWED_KEYS = ['partner']

async function sb(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY)
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('Prefer', 'return=representation,resolution=merge-duplicates')
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, { ...init, headers })
  if (!res.ok) throw new Error(await res.text())
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE)))) {
    return json({ error: 'unauthorized' }, 401)
  }
  const key = new URL(request.url).searchParams.get('key') ?? 'partner'
  if (!ALLOWED_KEYS.includes(key)) return json({ error: 'unknown_key' }, 400)

  const rows = await sb(env, `site_content?select=content,updated_at&key=eq.${key}&limit=1`)
  const row = rows?.[0]
  if (!row) return json({ error: 'not_found' }, 404)
  return json({ content: row.content, updatedAt: row.updated_at })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE)))) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: { key?: string; content?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const key = String(body.key ?? 'partner')
  if (!ALLOWED_KEYS.includes(key)) return json({ error: 'unknown_key' }, 400)

  // 실수로 빈 값이 저장되면 실제 사이트가 통째로 비어 버린다. 최소한의 안전판.
  const content = body.content
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return json({ error: 'empty_content' }, 400)
  }

  try {
    const rows = await sb(env, 'site_content?on_conflict=key', {
      method: 'POST',
      body: JSON.stringify([{ key, content, updated_at: new Date().toISOString() }]),
    })
    return json({ ok: true, updatedAt: rows?.[0]?.updated_at ?? null })
  } catch (e) {
    return json({ error: 'save_failed', detail: String(e).slice(0, 200) }, 500)
  }
}
