import { supabase } from '@/lib/supabase'

/**
 * 혼술바(장소) 데이터. 소개팅·소셜링은 '이벤트'(events)지만 혼술바는 '상시 매장'이라
 * 별도 테이블 places 를 쓴다. 일시/신청 대신 영업시간·종류·혼술배지·지역으로 보여준다.
 */
export interface PlaceRow {
  id: string
  name: string
  category: string | null            // 종류: 위스키바/칵테일바/와인바/이자카야/펍/바
  region: string | null
  address_road: string | null
  lat: number | null
  lng: number | null
  tel: string | null
  instagram: string | null
  naver_url: string | null
  hours: Record<string, string> | null   // {"월":"18:30~00:30",...}
  late_night: boolean
  conveniences: string[]
  naver_rating: number | null
  naver_review_count: number | null
  thumbnail_url: string | null
  honsul_badges: string[]            // 혼술친화·조용·오래머물기·심야
  mood_tags: string[]                // 아늑·음악·차분·대화
  keyword_votes?: Record<string, number> | null   // 상세 전용: 네이버 키워드 투표 원본
}

const COLUMNS =
  'id,name,category,region,address_road,lat,lng,tel,instagram,naver_url,' +
  'hours,late_night,conveniences,naver_rating,naver_review_count,thumbnail_url,honsul_badges,mood_tags'

export async function fetchPlaces(): Promise<PlaceRow[]> {
  // places 는 아직 Database 타입에 없어 any 캐스트(파일럿 단계). 타입 생성은 스키마 확정 후.
  const sb = supabase as unknown as {
    from: (t: string) => any
  }
  const { data, error } = await sb
    .from('places')
    .select(COLUMNS)
    .eq('service', 'honsul')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as PlaceRow[]
}

export async function fetchPlace(id: string): Promise<PlaceRow | null> {
  const sb = supabase as unknown as { from: (t: string) => any }
  const { data, error } = await sb
    .from('places')
    .select(COLUMNS + ',keyword_votes')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as PlaceRow) ?? null
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 네이버 이미지 URL 은 &amp; 로 이스케이프돼 있어 그대로 쓰면 안 뜬다 — 되돌린다. */
export function cleanImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  return url.replace(/&amp;/g, '&')
}

/**
 * 지금 영업중인지 판정. 마감이 새벽(예: 02:00)이면 시작보다 작으므로 자정 넘김으로 처리.
 * 반환: { open, todayLabel } — todayLabel 은 "오늘 19:00~02:00" 형태(없으면 null).
 */
export function openStatus(hours: Record<string, string> | null): { open: boolean | null; todayLabel: string | null } {
  if (!hours) return { open: null, todayLabel: null }
  const now = new Date()
  // KST 기준(기기 로케일 무관하게 안전하게 +9)
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000)
  const day = DOW[kst.getDay()]
  const prevDay = DOW[(kst.getDay() + 6) % 7]
  const mins = kst.getHours() * 60 + kst.getMinutes()

  const within = (range: string | undefined, offset = 0): boolean => {
    if (!range) return false
    const [s, e] = range.split('~')
    if (!s || !e) return false
    const toM = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
    let start = toM(s), end = toM(e)
    if (end <= start) end += 1440 // 새벽 마감(자정 넘김)
    const t = mins + offset
    return t >= start && t < end
  }
  // 오늘 영업시간, 또는 어제 시작해 새벽까지 이어지는 경우(어제 범위 +1440 안에 지금이 드는지)
  const open = within(hours[day]) || within(hours[prevDay], 1440)
  return { open, todayLabel: hours[day] ? `오늘 ${hours[day]}` : null }
}
