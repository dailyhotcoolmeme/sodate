// 새 제휴처를 만들며 바로 초대까지 보낸다.
//
// 왜 필요한가: 초대 버튼이 «업체 목록» 위에 달려 있는데, 문토·프립 같은 모임 플랫폼은
// 그 한 줄이 플랫폼 전체다. 그 안에서 모임을 여는 개별 호스트에게는 초대를 걸 대상이
// 아예 없었다(2026-09-05 오너 지적). 그래서 호스트마다 새 줄을 만들어 초대한다.
//
// 크롤링과는 완전히 분리된다 — crawl_enabled=false 로 만들어서 크롤러가 건드리지 않고,
// 문토·프립 쪽 크롤 데이터도 그대로 남는다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { issueInvite, sb, type InviteEnv } from '../_lib/partner-invite'

interface Env extends InviteEnv {
  SESSION_SECRET: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * slug 는 유일해야 하고 R2 경로에도 들어간다. 업체명이 한글이면 쓸 수 있는 글자가
 * 안 남으므로, 영문·숫자만 추려 쓰되 비면 임의값으로 대신한다.
 */
function makeSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const suffix = crypto.randomUUID().slice(0, 8)
  return ascii ? `${ascii}-${suffix}` : `partner-${suffix}`
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE)))) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.PARTNER_INVITE_SECRET) {
    return json({ error: 'server_not_configured' }, 500)
  }

  let body: { name?: string; email?: string; tier?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const tier = body.tier === 'paid' ? 'paid' : 'free'
  if (!name) return json({ error: 'missing_name' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400)

  // 같은 이름이 이미 있으면 새로 만들지 않는다 — 실수로 중복 줄이 생기면 앱 목록에
  // 같은 이름이 두 개 뜨고, 어느 쪽에 일정이 붙는지 알 수 없게 된다.
  const dup = await sb(env, `companies?select=id,name&name=eq.${encodeURIComponent(name)}&limit=1`)
  if (dup?.[0]) {
    return json({ error: 'name_taken', existingId: dup[0].id }, 409)
  }

  let companyId: string
  try {
    const created = await sb(env, 'companies', {
      method: 'POST',
      preferReturn: true,
      body: JSON.stringify({
        name,
        slug: makeSlug(name),
        // 아래 셋은 NOT NULL 이지만 크롤링을 안 하니 쓸 값이 없다. 빈 값으로 둔다.
        base_url: '',
        crawl_url: '',
        crawl_type: 'static',
        // ★ 크롤러가 절대 건드리지 않게 한다(크롤 대상 선정 기준이 이 칸이다).
        crawl_enabled: false,
        app_visible: true,
        plan: 'partner',
        partner_tier: tier,
      }),
    })
    companyId = created?.[0]?.id
    if (!companyId) throw new Error('no id returned')
  } catch (e) {
    return json({ error: 'create_failed', detail: String(e).slice(0, 200) }, 500)
  }

  try {
    const result = await issueInvite(env, companyId, email, name)
    return json({ ok: true, companyId, ...result }, 201)
  } catch (e) {
    // 업체는 만들어졌으니 그 사실을 알려준다 — 안 그러면 오너가 다시 눌러 중복을 만든다.
    return json(
      { ok: true, companyId, mailSent: false, inviteUrl: '', warning: 'invite_failed', detail: String(e).slice(0, 200) },
      201,
    )
  }
}
