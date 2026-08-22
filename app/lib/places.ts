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
  profile_image: string | null       // 업체 인스타 프로필 이미지(R2 재호스팅) — 피드 썸네일
  images: string[]                   // 네이버 대표사진(현재 미사용, 인스타로 전환)
  instagram_media: InstaMedia[]      // 업체 인스타 게시물/릴스(사진·영상)
  honsul_badges: string[]            // 특징 태그(술종류多·대화·음악·심야 …)
  mood_tags: string[]                // (통합) 현재 미사용
  socials: Record<string, string>    // {instagram, facebook, x, youtube, homepage}
  keyword_votes?: Record<string, number> | null   // 상세 전용: 네이버 키워드 투표 원본
}

export interface InstaMedia {
  code: string
  is_reel: boolean
  thumb: string | null
  url: string
}

const COLUMNS =
  'id,name,category,region,address_road,lat,lng,tel,instagram,naver_url,' +
  'hours,late_night,conveniences,naver_rating,naver_review_count,thumbnail_url,profile_image,images,instagram_media,honsul_badges,mood_tags,socials'

// 종류별 커버 아이콘(Ionicons — 이모지는 시뮬/기기에서 깨질 수 있어 사용 안 함)·색
export function categoryCover(category: string | null): { icon: string; bg: string; tint: string } {
  switch (category) {
    case '위스키바': return { icon: 'wine', bg: '#2c2013', tint: '#d9a441' }
    case '칵테일바': return { icon: 'wine', bg: '#2e1626', tint: '#e06aa0' }
    case '와인바': return { icon: 'wine', bg: '#2a1420', tint: '#d16a86' }
    case '이자카야': return { icon: 'restaurant', bg: '#2c1d12', tint: '#dc9152' }
    case '하이볼바': return { icon: 'beer', bg: '#20261a', tint: '#a9c46a' }
    case 'LP바': return { icon: 'musical-notes', bg: '#1f1a2c', tint: '#a58cff' }
    case '펍': return { icon: 'beer', bg: '#2a2410', tint: '#d9c441' }
    default: return { icon: 'wine', bg: '#20202a', tint: '#c0a0b0' }
  }
}

/** 소셜 링크 → 아이콘 목록(피드·상세 공용). 있는 소셜은 전부. */
const SOCIAL_ICON: Record<string, string> = {
  instagram: 'logo-instagram', facebook: 'logo-facebook', x: 'logo-twitter',
  youtube: 'logo-youtube', homepage: 'globe-outline',
}
export function socialLinks(p: Pick<PlaceRow, 'socials' | 'instagram'>): { icon: string; url: string; key: string }[] {
  const s = { ...(p.socials ?? {}) }
  if (!s.instagram && p.instagram) s.instagram = p.instagram
  const order = ['instagram', 'facebook', 'x', 'youtube', 'homepage']
  return order.filter((k) => s[k]).map((k) => ({ icon: SOCIAL_ICON[k], url: s[k], key: k }))
}

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
 * 지금 영업중인지 + '오늘(문 여는 요일 기준)' 영업시간.
 * "오늘 요일" = 문을 여는 시각이 속한 요일. 새벽엔 어젯밤 세션이 이어질 수 있으므로,
 * 지금이 어제 세션(자정 넘김) 안이면 그 세션(어제 요일)을 오늘로 본다.
 * 반환: { open, hoursLabel } — hoursLabel 예: "21:00~05:00" (없으면 null).
 */
export function openStatus(hours: Record<string, string> | null): { open: boolean | null; hoursLabel: string | null } {
  if (!hours || Object.keys(hours).length === 0) return { open: null, hoursLabel: null }
  const now = new Date()
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
    if (end <= start) end += 1440
    const t = mins + offset
    return t >= start && t < end
  }
  const openToday = within(hours[day])
  const openPrev = within(hours[prevDay], 1440)   // 어젯밤부터 새벽까지 이어지는 세션
  const open = openToday || openPrev
  // 지금이 어제 세션(새벽)이면 어제 시간표를, 아니면 오늘 시간표(문 여는 요일 기준)를 보여준다.
  const label = openPrev && !openToday ? hours[prevDay] : hours[day]
  return { open, hoursLabel: label ?? null }
}
