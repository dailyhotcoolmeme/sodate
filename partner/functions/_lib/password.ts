// 비밀번호 해시 — Cloudflare Pages Functions(Workers 런타임)는 Node 네이티브 바인딩이
// 필요한 bcrypt를 못 쓴다. Web Crypto(crypto.subtle)는 admin/functions/_lib/session.ts
// 에서 이미 검증됐으니, 같은 API로 PBKDF2-SHA256을 쓴다 — 외부 의존성 없이 런타임
// 표준만으로 충분히 안전하다(OWASP 권장 반복 횟수 이상).
//
// 저장 형식: "pbkdf2$반복횟수$salt(b64url)$hash(b64url)" — 반복 횟수를 같이 저장해
// 나중에 정책을 올려도(느려져도) 옛 해시를 그대로 검증할 수 있다.

const ITERATIONS = 210_000 // OWASP 2023 권장 최소치 이상
const ALGORITHM = 'pbkdf2'
const HASH_BITS = 256

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
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

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS,
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await derive(password, salt, ITERATIONS)
  return `${ALGORITHM}$${ITERATIONS}$${b64url(salt.buffer as ArrayBuffer)}$${b64url(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== ALGORITHM) return false
  const iterations = parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = b64urlToBytes(parts[2])
  const expected = parts[3]
  const bits = await derive(password, salt, iterations)
  const actual = b64url(bits)
  // 길이가 다르면 즉시 false 여도 안전하다 — b64url 결과는 항상 고정 길이(같은
  // HASH_BITS)라 여기서 타이밍으로 새어나갈 정보가 없다(salt·iterations가 이미
  // 노출된 stored 문자열 안에 있으므로 추가로 숨길 게 없다).
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** 초대 시 비번 미설정 상태를 나타내는, 어떤 실제 비번으로도 절대 안 나올 값. */
export function unusablePasswordHash(): string {
  return `unusable$${crypto.randomUUID()}`
}
