// R2 공개 이미지 서빙. 인증 없음(공개 읽기). 이그레스는 R2 → 무료.
// 에지 캐시 + 앱(expo-image) 로컬 캐시로 재요청은 거의 없음.

interface Env {
  MEDIA: R2Bucket
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 })
  }
  const raw = params.path
  const key = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
  if (!key) return new Response('not found', { status: 404 })

  const obj = await env.MEDIA.get(key)
  if (!obj) return new Response('not found', { status: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
}
