// 관리자 세션: HMAC-SHA256 서명 토큰을 HttpOnly 쿠키에 담는다.
// 비밀(SESSION_SECRET)은 CF Pages 시크릿에만 존재하며 클라이언트 번들엔 없다.

const ENC = new TextEncoder()

export const COOKIE = 'sodate_admin'
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

export async function signSession(secret: string, ttlSec = TTL_SEC): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload = b64url(ENC.encode(JSON.stringify({ sub: 'admin', exp })))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, ENC.encode(payload))
  return `${payload}.${b64url(sig)}`
}

export async function verifySession(secret: string, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  try {
    const key = await hmacKey(secret)
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), ENC.encode(payload))
    if (!ok) return false
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)))
    return typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
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
