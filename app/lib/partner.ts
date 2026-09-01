/**
 * 제휴업체 판정 — '모잇 할인' 딱지를 그릴지 결정한다(2026-09-02).
 *
 * 소개팅·소셜링과 혼술바의 규칙이 다르다:
 *
 * - **소개팅·소셜링(companies)**: plan 만 본다. 기간을 두지 않는 이유는 일정 자체가
 *   날짜가 지나면 피드에서 사라지기 때문이다 — 제휴가 끝나면 그 업체 일정이 더 안
 *   올라오고, 남아 있던 일정도 곧 지나간다(오너 판단).
 *
 * - **혼술바(places)**: 매장은 날짜와 무관하게 상시 노출되므로 기간이 필요하다.
 *   admin 에서 넣은 시작·종료일 사이일 때만 딱지가 보인다.
 *
 * ⚠️ 날짜 비교는 **KST 로 자른 날짜 문자열끼리** 한다. Date 로 바꿔 비교하면 기기
 *    표준시(해외 사용자)에 따라 하루가 밀려, 종료일 당일에 딱지가 사라지거나
 *    시작일 하루 전에 미리 보이는 일이 생긴다. 문자열 비교면 그 여지가 없다.
 */

/** 오늘(KST) 을 'YYYY-MM-DD' 로. DB의 date 컬럼과 같은 모양이라 그대로 비교된다. */
function todayKST(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60 + 9 * 3600) * 1000)
  const m = `${kst.getMonth() + 1}`.padStart(2, '0')
  const d = `${kst.getDate()}`.padStart(2, '0')
  return `${kst.getFullYear()}-${m}-${d}`
}

/** 소개팅·소셜링 업체가 제휴사인가. */
export function isPartnerCompany(company?: { plan?: string | null } | null): boolean {
  return company?.plan === 'partner'
}

/** 혼술바 매장이 **오늘 기준** 제휴 중인가. 날짜가 비어 있으면 그쪽 제한은 없는 것으로 본다. */
export function isPartnerPlace(place?: {
  plan?: string | null
  plan_starts_at?: string | null
  plan_ends_at?: string | null
} | null): boolean {
  if (place?.plan !== 'partner') return false
  const today = todayKST()
  if (place.plan_starts_at && today < place.plan_starts_at) return false
  if (place.plan_ends_at && today > place.plan_ends_at) return false
  return true
}
