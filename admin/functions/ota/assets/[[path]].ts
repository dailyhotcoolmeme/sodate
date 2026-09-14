// 앱 업데이트 파일(번들·이미지·폰트)을 R2 에서 그대로 내려준다.
// 인증 없음(공개 읽기) — 사진 서빙(functions/media)과 같은 구조다. 이그레스는 R2 → 무료.
//
// 파일 이름은 «내용의 MD5» 라서 내용이 바뀌면 이름도 바뀐다.
// 그래서 영구 캐시를 걸어도 안전하다(같은 이름 = 언제나 같은 내용).

interface Env {
  MEDIA: R2Bucket
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 })
  }

  const raw = params.path
  const key = Array.isArray(raw) ? raw.join('/') : String(raw ?? '')
  // 내용 MD5(16진 32자)만 허용한다. 경로를 거슬러 올라가는 요청을 막는다.
  if (!/^[0-9a-f]{32}$/.test(key)) return new Response('not found', { status: 404 })

  const obj = await env.MEDIA.get(`ota/assets/${key}`)
  if (!obj) return new Response('not found', { status: 404 })

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
}
