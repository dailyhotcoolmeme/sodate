// 파트너가 등록한 일정 하나 수정(PATCH) / 삭제(DELETE).
//
// ⚠️ 두 조건을 항상 같이 건다: company_id=세션의 회사 AND is_partner_direct=true.
//    두 번째 조건이 없으면, 크롤러가 채워둔 그 업체의 다른 일정(예: 로꼬가 직접
//    등록도 하고 크롤링도 같이 되는 경우)까지 포털에서 고치거나 지울 수 있게 된다.
//    이 조건이 안 맞으면 PostgREST가 그냥 '대상 없음'으로 처리해 0건 수정/삭제되므로,
//    남의 것이거나 크롤러 소유인 행은 자동으로 보호된다.
import { verifySession, getCookie, COOKIE, json } from '../../_lib/session'
import { db, type DbEnv } from '../../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

function ownFilter(companyId: string, id: string): string {
  return `id=eq.${id}&company_id=eq.${companyId}&is_partner_direct=eq.true`
}

interface PatchBody {
  title?: string
  description?: string | null
  thumbnail_urls?: string[]
  detail_images?: string[]
  event_date?: string
  location_region?: string
  price_male?: number | null
  price_female?: number | null
  partner_price_male?: number | null
  partner_price_female?: number | null
  capacity_male?: number | null
  capacity_female?: number | null
  seats_left_male?: number | null
  seats_left_female?: number | null
  hashtags?: string[]
  is_active?: boolean
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id ?? '')
  if (!id) return json({ error: 'missing_id' }, 400)

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  // 화이트리스트만 통과시킨다 — company_id·is_partner_direct·verified 는 여기서
  // 절대 안 받는다(고정값이어야 하는 시스템 필드).
  const patch: Record<string, unknown> = {}
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if ('description' in body) patch.description = body.description ?? null
  if (Array.isArray(body.thumbnail_urls)) patch.thumbnail_urls = body.thumbnail_urls
  if (Array.isArray(body.detail_images)) patch.detail_images = body.detail_images
  if (typeof body.event_date === 'string') {
    if (Number.isNaN(new Date(body.event_date).getTime())) {
      return json({ error: 'invalid_event_date' }, 400)
    }
    patch.event_date = body.event_date
  }
  if (typeof body.location_region === 'string') patch.location_region = body.location_region.trim()
  if ('price_male' in body) patch.price_male = body.price_male ?? null
  if ('price_female' in body) patch.price_female = body.price_female ?? null
  if ('partner_price_male' in body) patch.partner_price_male = body.partner_price_male ?? null
  if ('partner_price_female' in body) patch.partner_price_female = body.partner_price_female ?? null
  if ('capacity_male' in body) patch.capacity_male = body.capacity_male ?? null
  if ('capacity_female' in body) patch.capacity_female = body.capacity_female ?? null
  if ('seats_left_male' in body) patch.seats_left_male = body.seats_left_male ?? null
  if ('seats_left_female' in body) patch.seats_left_female = body.seats_left_female ?? null
  if (Array.isArray(body.hashtags)) patch.hashtags = body.hashtags
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active

  if (Object.keys(patch).length === 0) return json({ error: 'empty_patch' }, 400)

  try {
    const updated = await db.update(env, 'events', ownFilter(session.companyId, id), patch)
    if (!updated.length) return json({ error: 'not_found' }, 404)
    return json({ event: updated[0] })
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)
  const id = String(params.id ?? '')
  if (!id) return json({ error: 'missing_id' }, 400)

  try {
    // 삭제 전 실제로 내 것이 맞는지 먼저 확인 — DELETE 는 대상 없음과 원래 없음을
    // 구분 못 하므로, 프론트에 정확한 404를 돌려주려면 select 를 한 번 더 해야 한다.
    const rows = await db.select(env, 'events', `select=id&${ownFilter(session.companyId, id)}`)
    if (!rows.length) return json({ error: 'not_found' }, 404)
    await db.delete(env, 'events', ownFilter(session.companyId, id))
    return json({ ok: true })
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}
