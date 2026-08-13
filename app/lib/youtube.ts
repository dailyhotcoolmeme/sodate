/**
 * 게시판 첨부 유튜브 링크 처리(2026-08-13). 인앱 재생은 안 하고(WebView·영상플레이어
 * 미설치 — 넣으려면 새 네이티브 빌드 필요, 오너 결정으로 1단계는 외부 재생만) 썸네일만
 * 만들어 보여주고 탭하면 외부(유튜브 앱/브라우저)에서 연다.
 *
 * 썸네일은 API 호출 없이 img.youtube.com URL 패턴으로 바로 만든다(공개 규칙이라
 * 인증·요청 불필요).
 */
export function youtubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1)
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host === 'youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v') ?? ''
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
      }
      const m = u.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/)
      return m ? m[1] : null
    }
    return null
  } catch {
    return null
  }
}

export function youtubeThumbnail(url: string): string | null {
  const id = youtubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}
