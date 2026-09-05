// 파트너가 직접 등록한 일정 — 목록 조회(GET) / 새로 등록(POST).
//
// ⚠️ company_id는 절대 클라이언트가 보낸 값을 쓰지 않는다. 세션에서만 꺼낸다 —
//    안 그러면 업체가 남의 company_id를 넣어 다른 업체 소유로 등록할 수 있다.
import { verifySession, getCookie, COOKIE, json } from '../../_lib/session'
import { db, type DbEnv } from '../../_lib/db'

interface Env extends DbEnv {
  SESSION_SECRET: string
}

const SELECT_FIELDS =
  'id,title,description,thumbnail_urls,detail_images,event_date,location_region,price_male,price_female,' +
  'capacity_male,capacity_female,seats_left_male,seats_left_female,hashtags,is_active,created_at'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)

  try {
    const rows = await db.select(
      env,
      'events',
      `select=${SELECT_FIELDS}&company_id=eq.${session.companyId}&is_partner_direct=eq.true&order=event_date.desc`,
    )
    return json({ events: rows })
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}

interface CreateBody {
  title?: string
  description?: string
  thumbnail_urls?: string[]
  detail_images?: string[]
  event_date?: string
  location_region?: string
  price_male?: number | null
  price_female?: number | null
  capacity_male?: number | null
  capacity_female?: number | null
  seats_left_male?: number | null
  seats_left_female?: number | null
  hashtags?: string[]
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await verifySession(env.SESSION_SECRET, getCookie(request, COOKIE))
  if (!session) return json({ error: 'unauthorized' }, 401)

  let body: CreateBody
  try {
    body = await request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const title = String(body.title ?? '').trim()
  const eventDate = String(body.event_date ?? '')
  const region = String(body.location_region ?? '').trim()
  if (!title) return json({ error: 'missing_title' }, 400)
  if (!eventDate || Number.isNaN(new Date(eventDate).getTime())) {
    return json({ error: 'missing_or_invalid_event_date' }, 400)
  }
  if (!region) return json({ error: 'missing_location_region' }, 400)

  const row = {
    company_id: session.companyId,
    title,
    description: body.description ?? null,
    thumbnail_urls: Array.isArray(body.thumbnail_urls) ? body.thumbnail_urls : [],
    detail_images: Array.isArray(body.detail_images) ? body.detail_images : [],
    event_date: eventDate,
    location_region: region,
    price_male: body.price_male ?? null,
    price_female: body.price_female ?? null,
    capacity_male: body.capacity_male ?? null,
    capacity_female: body.capacity_female ?? null,
    seats_left_male: body.seats_left_male ?? null,
    seats_left_female: body.seats_left_female ?? null,
    hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
    // 아래 넷은 시스템이 정한다 — 클라이언트가 흉내 낼 수 없게 여기서만 세팅.
    source_url: `partner://${session.companyId}/${crypto.randomUUID()}`,
    is_partner_direct: true,
    verified: true, // 크롤러의 지난 일정 정리·스테일 삭제에서 제외되는 정본 플래그
    is_active: true,
  }

  try {
    const created = await db.insert(env, 'events', row)
    return json({ event: created[0] }, 201)
  } catch {
    return json({ error: 'server_error' }, 500)
  }
}
