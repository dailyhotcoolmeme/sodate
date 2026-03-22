// 간단한 관리자 인증 — env에 설정된 비밀번호 비교
// 실제 운영 시 Supabase Auth로 교체 가능

const ADMIN_ID = import.meta.env.VITE_ADMIN_ID
const ADMIN_PW = import.meta.env.VITE_ADMIN_PW
const SESSION_KEY = 'sodate_admin_session'

export function login(id: string, pw: string): boolean {
  if (id === ADMIN_ID && pw === ADMIN_PW) {
    sessionStorage.setItem(SESSION_KEY, 'true')
    return true
  }
  return false
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function isLoggedIn(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}
