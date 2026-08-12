import { signSession, sessionCookie, json, TTL_SEC } from '../_lib/session'

interface Env {
  ADMIN_ID: string
  ADMIN_PW: string
  SESSION_SECRET: string
}

/**
 * 길이·내용이 달라도 같은 시간이 걸리게 비교한다. `a !== b` 는 첫 다른 글자에서 바로
 * 끝나서 응답 시간으로 비밀번호를 한 글자씩 좁힐 여지가 있다.
 */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/**
 * 무차별 대입 완화. 관리자 계정 하나가 뚫리면 service_role 전체 권한(비밀 댓글 본문
 * 포함)이 넘어가는데 그동안 지연도 횟수 제한도 없었다(2026-08-13 보안 감사).
 *
 * ⚠️ 한계: Cloudflare Pages Functions 는 요청마다 다른 isolate 로 갈 수 있어 이 Map 이
 *    공유된다는 보장이 없다(실측으로 확인 — 연속 6회 실패가 전부 401 로 통과했다).
 *    같은 isolate 를 재사용하는 지속적 공격에는 걸리지만, 확실한 차단은 아니다.
 *    확실히 막으려면 Cloudflare 대시보드의 Rate limiting rules 에서
 *    `/api/login` 을 IP 당 분당 N회로 제한해야 한다(대시보드 설정이라 코드로는 못 한다).
 *    그래서 아래 고정 지연은 카운터와 무관하게 항상 건다 — 이것만으로도 초당 수천 회
 *    시도는 불가능해진다.
 */
const failCounts = new Map<string, { n: number; until: number }>()
const LOCK_AFTER = 5           // 이 횟수를 넘기면 잠금(같은 isolate 안에서만 보장)
const LOCK_MS = 5 * 60 * 1000  // 5분
const MIN_FAIL_DELAY_MS = 700  // 실패 시 항상 거는 최소 지연

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_ID || !env.ADMIN_PW || !env.SESSION_SECRET) {
    return json({ error: 'server_not_configured' }, 500)
  }

  // Cloudflare 가 붙여주는 접속 IP. 위조하면 오히려 자기 몫의 카운터가 갈리므로 무의미하다.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const now = Date.now()
  const rec = failCounts.get(ip)
  if (rec && rec.until > now) {
    return json({ error: 'too_many_attempts', retry_after_sec: Math.ceil((rec.until - now) / 1000) }, 429)
  }

  let body: { id?: string; pw?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const id = String(body.id ?? '')
  const pw = String(body.pw ?? '')

  if (!safeEqual(id, env.ADMIN_ID) || !safeEqual(pw, env.ADMIN_PW)) {
    const n = (rec?.n ?? 0) + 1
    failCounts.set(ip, { n, until: n >= LOCK_AFTER ? now + LOCK_MS : 0 })
    // 실패는 항상 느리게 답한다(isolate 가 갈려도 유효). 같은 isolate 면 더 느려진다.
    await new Promise((r) => setTimeout(r, Math.min(MIN_FAIL_DELAY_MS + (n - 1) * 400, 3000)))
    return json({ error: 'invalid_credentials' }, 401)
  }
  failCounts.delete(ip)

  const token = await signSession(env.SESSION_SECRET)
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, TTL_SEC) })
}
