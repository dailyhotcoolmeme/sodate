import { createClient } from '@supabase/supabase-js'

// service_role 키는 클라이언트 번들에 두지 않는다.
// 모든 요청은 동일 출처 Pages Function(/api/sb)이 세션 쿠키를 검증한 뒤
// 서버에서 service_role 로 Supabase 에 프록시한다. (apikey 'proxy' 는 서버가 덮어씀)
const PROXY_URL = `${window.location.origin}/api/sb`

export const supabase = createClient(PROXY_URL, 'proxy', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
  },
})

// 이미지 업로드는 R2(이그레스 무료)로. 서버 Pages Function(/api/upload)이 세션 검증 후 R2 에 저장,
// 공개 서빙은 /media/<key>. Supabase Storage 는 이그레스 비용 때문에 쓰지 않는다.
export async function uploadDetailImage(file: File, slug: string, typeId: string): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('slug', slug)
  fd.append('typeId', typeId)
  const res = await fetch('/api/upload', { method: 'POST', body: fd, credentials: 'include' })
  if (!res.ok) throw new Error(`업로드 실패 (${res.status})`)
  const data = await res.json()
  return data.url as string
}

export async function deleteDetailImage(url: string): Promise<void> {
  const key = detailImageKey(url)
  if (!key) return
  await fetch(`/api/upload?key=${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'include' })
}

// 공개 URL(/media/<key>) → R2 키 추출
export function detailImageKey(url: string): string | null {
  const i = url.indexOf('/media/')
  return i < 0 ? null : url.slice(i + '/media/'.length)
}
