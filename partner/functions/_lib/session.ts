// 파트너 세션: admin/functions/_lib/session.ts 와 같은 HMAC-SHA256 서명 토큰 +
// HttpOnly 쿠키 방식. admin은 payload가 sub:'admin' 고정값 하나뿐이라 그대로 못
// 쓴다 — 업체가 여럿이라 sub 에 company_id 를 담는다.
// 비밀(SESSION_SECRET)은 CF Pages 시크릿에만 있고 클라이언트 번들엔 없다.
// ⚠️ admin과 쿠키 이름이 겹치면 안 된다 — 완전히 분리된 사이트(도메인)라 실제로는
//    안 겹치지만, 혹시 같은 상위 도메인에 걸릴 경우를 대비해 이름 자체를 다르게 둔다.

const ENC = new TextEncoder()

export const COOKIE = 'sodate_partner'
export const TTL_SEC = 60 * 60 * 12 // 12시간

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(str: string): Uint8Array {
  let t = str.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  const bin = atob(t)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    ENC.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export interface SessionPayload {
  companyId: string
  exp: number
}

export async function signSession(
  secret: string,
  companyId: string,
  ttlSec = TTL_SEC,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload = b64url(ENC.encode(JSON.stringify({ companyId, exp })))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payload))
  return `${payload}.${b64url(sig)}`
}

/** 유효하면 payload(companyId 포함)를, 아니면 null을 돌려준다. */
export async function verifySession(
  secret: string,
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!secret || !token) return null
  const dot = token.indexOf('.')
  if (dot < 1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  try {
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), ENC.encode(payload))
    if (!ok) return null
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as SessionPayload
    if (typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now() / 1000)) return null
    if (typeof data.companyId !== 'string' || !data.companyId) return null
    return data
  } catch {
    return null
  }
}

export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') || ''
  for (const part of header.split(/;\s*/)) {
    const idx = part.indexOf('=')
    if (idx > -1 && part.slice(0, idx) === name) return decodeURIComponent(part.slice(idx + 1))
  }
  return undefined
}

export function sessionCookie(token: string, maxAge = TTL_SEC): string {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

export function json(obj: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}

/** 길이·내용이 달라도 같은 시간이 걸리게 비교한다(admin login.ts 와 같은 이유). */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
