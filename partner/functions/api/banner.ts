// 배너 광고 — 유료 등급 업체 전용. 파트너가 이미지를 올리면 바로 앱에 노출되는 게
// 아니라, admin '제휴 관리 → 배너' 탭에 is_active=false 상태로 올라가고 오너가
// 검수 후 켠다(banners.is_active 기본값이 true라, 여기서 명시적으로 false로 넣지
// 않으면 검수 없이 바로 노출된다 — 배너 자리는 한정돼 있어 오너가 순서·기간을
// 관리해야 한다).
//
// 업체당 배너는 하나만 유지한다(여러 개 올리면 요청이 계속 쌓이는 걸 막기 위해) —
// target_type='company' AND target_value=company_id 인 기존 행이 있으면 그 행을
// 덮어쓴다.
import { verifySession, getCookie, COOKIE, json } from '../_lib/session'
import { db, type DbEnv } from '../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

interface BannerRow {
  id: string
  image_url: string
  is_active: boolean
  updated_at: string
}

async function requireCompany(env: Env, request: Request) {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return null
  const rows = await db.select<{ partner_tier: string | null }>(
    env,
    'companies',
    `select=partner_tier&id=eq.${session.companyId}&limit=1`,
  )
  if (rows[0]?.partner_tier !== 'paid') return null
  return session
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireCompany(env, request)
  if (!session) return json({ error: 'unauthorized' }, 401)

  const rows = await db.select<BannerRow>(
    env,
    'banners',
    `select=id,image_url,is_active,updated_at&target_type=eq.company&target_value=eq.${session.companyId}&limit=1`,
  )
  return json({ banner: rows[0] ?? null })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const session = await requireCompany(env, request)
  if (!session) return json({ error: 'unauthorized' }, 401)

  let body: { image_url?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const imageUrl = String(body.image_url ?? '')
  if (!imageUrl) return json({ error: 'missing_image_url' }, 400)

  const existing = await db.select<{ id: string }>(
    env,
    'banners',
    `select=id&target_type=eq.company&target_value=eq.${session.companyId}&limit=1`,
  )

  if (existing[0]) {
    const updated = await db.update(env, 'banners', `id=eq.${existing[0].id}`, {
      image_url: imageUrl,
      // 이미지를 바꾸면 다시 검수받아야 한다 — 이전 이미지로 이미 켜져 있었어도
      // 새 이미지는 오너가 확인하기 전엔 안 나간다.
      is_active: false,
    })
    return json({ banner: updated[0] })
  }

  const created = await db.insert(env, 'banners', {
    menu: 'dating',
    image_url: imageUrl,
    target_type: 'company',
    target_value: session.companyId,
    is_active: false,
    memo: '파트너 포털에서 제출(오너 검수 대기)',
  })
  return json({ banner: created[0] }, 201)
}
