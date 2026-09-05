// 파트너 인증은 서버(CF Pages Functions)에서 처리한다. 비밀번호/세션 비밀은
// 클라이언트에 없고, 세션은 HttpOnly 쿠키로만 유지된다. admin/src/lib/auth.ts 와 같은 구조.

export interface Me {
  authenticated: boolean
  companyId?: string
  companyName?: string
  tier?: 'free' | 'paid'
}

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    })
    if (res.ok) return { ok: true }
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error ?? 'unknown_error' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' })
  } catch {
    /* 무시 */
  }
}

export async function fetchMe(): Promise<Me> {
  try {
    const res = await fetch('/api/me', { credentials: 'include' })
    if (!res.ok) return { authenticated: false }
    return await res.json()
  } catch {
    return { authenticated: false }
  }
}

export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
      credentials: 'include',
    })
    if (res.ok) return { ok: true }
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error ?? 'unknown_error' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}
