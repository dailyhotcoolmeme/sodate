// 파트너 이미지 업로드 — admin/functions/api/upload.ts 와 같은 R2 버킷을 쓰지만,
// 저장 경로는 항상 세션의 company_id 밑으로만 고정한다(클라이언트가 폴더를 못 고름 —
// admin은 오너 전용이라 folder를 자유 입력받지만, 여기는 업체가 남의 폴더에 쓰지
// 못하게 서버가 강제로 정한다).
//
// 공개 서빙은 새로 안 만든다 — admin/functions/media/[[path]].ts 가 이미 이 버킷을
// 인증 없이 공개 서빙하고 있어 그 도메인을 그대로 URL에 쓴다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'

interface Env {
  SESSION_SECRET: string
  MEDIA: R2Bucket
}

const MEDIA_BASE = 'https://sodate-admin.pages.dev'
const MAX_BYTES = 8 * 1024 * 1024 // 8MB
const SAFE_EXT = /[^a-z0-9]/g

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)
  if (!env.MEDIA) return json({ error: 'r2_not_bound' }, 500)

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return json({ error: 'no_file' }, 400)
  if (file.size > MAX_BYTES) return json({ error: 'file_too_large', max_bytes: MAX_BYTES }, 400)
  if (!file.type.startsWith('image/')) return json({ error: 'not_an_image' }, 400)

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(SAFE_EXT, '') || 'jpg'
  const key = `partner/${session.companyId}/${crypto.randomUUID()}.${ext}`

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  })

  return json({ ok: true, url: `${MEDIA_BASE}/media/${key}` })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)
  const url = new URL(request.url).searchParams.get('url') ?? ''
  const prefix = `${MEDIA_BASE}/media/partner/${session.companyId}/`
  // ⚠️ 접두사 검사 필수 — 없으면 아무 URL이나 넣어 남의 회사 사진이나 media 밖의
  // 임의 R2 키를 지울 수 있다.
  if (!url.startsWith(prefix)) return json({ error: 'forbidden' }, 403)
  const key = url.slice(`${MEDIA_BASE}/media/`.length)
  await env.MEDIA.delete(key)
  return json({ ok: true })
}
