/**
 * 게시판 첨부 인스타그램 링크 검증(2026-08-24, 유튜브 옆에 추가). 인앱 재생·썸네일은
 * 안 한다 — 인스타는 UA 보내면 링크가 사라지는 등 접근이 불안정하고(이 프로젝트
 * 다른 곳에서도 이미 겪음), 공개 썸네일 URL 규칙도 없다.
 * 그냥 검증만 하고, 카드는 아이콘 자리표시(placeholder)로 보여준 뒤 탭하면 외부(인스타
 * 앱/브라우저)로 연다 — 유튜브와 같은 "아웃링크" 취급.
 */
export function isInstagramUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    const host = u.hostname.replace(/^www\./, '')
    if (host !== 'instagram.com') return false
    return /^\/(p|reel|reels|tv)\//.test(u.pathname)
  } catch {
    return false
  }
}
