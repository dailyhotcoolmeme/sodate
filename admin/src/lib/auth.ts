// 관리자 인증은 서버(CF Pages Functions)에서 처리한다.
// 비밀번호/세션 비밀은 클라이언트에 존재하지 않으며, 세션은 HttpOnly 쿠키로만 유지된다.

export async function login(id: string, pw: string): Promise<boolean> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, pw }),
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' })
  } catch {
    /* 무시 */
  }
}

export async function checkSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/me', { credentials: 'include' })
    return res.ok
  } catch {
    return false
  }
}
