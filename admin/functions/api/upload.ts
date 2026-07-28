// R2 이미지 업로드/삭제 (세션 인증). 업로드 후 공개 URL(/media/<key>) 반환.
// 이그레스 무료인 R2 에 저장하고, 공개 읽기는 functions/media/[[path]].ts 가 담당.

import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  MEDIA: R2Bucket
  /** 저장될 이미지 URL의 고정 도메인. 미설정이면 요청 origin을 쓴다(로컬 개발용 폴백). */
  PUBLIC_MEDIA_BASE?: string
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

  // ⚠️ 여기서 만든 절대 URL이 DB에 영구 저장되고 앱이 그대로 렌더한다.
  // 예전엔 요청 origin을 그대로 썼는데, 로컬 `wrangler pages dev`에서 한 장만 올려도
  // http://localhost:8791/... 이 DB에 박혀 앱에서 영구히 깨졌다(2026-07-28 실제로 재현).
  // 어디서 올리든 항상 운영 도메인이 되도록 고정값을 우선한다.
  const base = (env.PUBLIC_MEDIA_BASE || new URL(request.url).origin).replace(/\/+$/, '')
  return json({ ok: true, key, url: `${base}/media/${key}` })
}
