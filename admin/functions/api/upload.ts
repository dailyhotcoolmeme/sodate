// R2 이미지 업로드/삭제 (세션 인증). 업로드 후 공개 URL(/media/<key>) 반환.
// 이그레스 무료인 R2 에 저장하고, 공개 읽기는 functions/media/[[path]].ts 가 담당.

import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  MEDIA: R2Bucket
}

const SAFE = /[^a-zA-Z0-9._-]/g

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const authed = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!authed) return json({ error: 'unauthorized' }, 401)
  if (!env.MEDIA) return json({ error: 'r2_not_bound' }, 500)

  // 삭제: DELETE /api/upload?key=<key>
  if (request.method === 'DELETE') {
    const key = new URL(request.url).searchParams.get('key')
    if (!key) return json({ error: 'missing_key' }, 400)
    await env.MEDIA.delete(key)
    return json({ ok: true })
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const form = await request.formData()
  const file = form.get('file')
  const slug = String(form.get('slug') || 'misc').replace(SAFE, '-')
  const typeId = String(form.get('typeId') || 'general').replace(SAFE, '-')
  if (!(file instanceof File)) return json({ error: 'no_file' }, 400)

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(SAFE, '')
  const key = `detail/${slug}/${typeId}/${crypto.randomUUID()}.${ext}`

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
  })

  const origin = new URL(request.url).origin
  return json({ ok: true, key, url: `${origin}/media/${key}` })
}
