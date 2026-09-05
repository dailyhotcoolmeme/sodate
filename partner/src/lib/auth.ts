// 파트너 인증은 서버(CF Pages Functions)에서 처리한다. 비밀번호/세션 비밀은
// 클라이언트에 없고, 세션은 HttpOnly 쿠키로만 유지된다. admin/src/lib/auth.ts 와 같은 구조.

export interface Me {
  authenticated: boolean
  companyId?: string
  companyName?: string
  /** 업체 로고. 17곳 중 1곳만 있어서, 없으면 화면에서 이름 첫 글자로 대신한다. */
  logoUrl?: string | null
  /** 로그인 아이디. 계정 설정 화면에서 지금 쓰는 아이디를 보여주는 데 쓴다. */
  email?: string
  tier?: 'free' | 'paid'
}

export interface InviteInfo {
  companyName: string
  email: string
}

/** 초대 링크의 토큰으로 "어느 업체 / 어떤 아이디"인지 미리 확인한다. */
export async function fetchInviteInfo(
  token: string,
): Promise<{ ok: true; info: InviteInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/invite-info?token=${encodeURIComponent(token)}`)
    const data = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, info: data as InviteInfo }
    return { ok: false, error: data.error ?? 'unknown_error' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
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
