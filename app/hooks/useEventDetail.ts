import { useState, useEffect, useCallback } from 'react'
import { supabase, type EventWithCompany } from '@/lib/supabase'

/**
 * 상세 설명 이미지 결정.
 *
 * 업체마다 모임 유형이 여러 개고(에모셔널오렌지 = 티키타카/사케시그널), 크롤로 새 일정이
 * 계속 들어오기 때문에 일정마다 손으로 지정하는 방식은 유지가 안 된다.
 * 그래서 **유형 이름이 모임명에 들어있으면 그 유형**으로 자동 매칭한다.
 *
 *   1) admin에서 일정에 유형을 직접 지정했으면 그걸 쓴다(예외 처리용 수동 우선)
 *   2) 없으면 모임명에 유형 이름이 포함되는 유형을 찾는다
 *      - 여러 개 걸리면 이름이 긴 쪽(더 구체적인 쪽)
 *   3) 아무것도 안 걸리면 빈 배열 → 상세 설명 섹션을 통째로 숨긴다
 *
 * ⚠️ 예전엔 3)에서 업체 기본 유형으로 떨어뜨렸는데, 그 탓에 사케시그널 12건에도
 *    티키타카 이미지가 나가고 있었다(2026-07-28 확인). 엉뚱한 이미지를 보여주느니
 *    안 보여주는 게 낫다 — 폴백을 없앤다.
 */
export function resolveDescImages(ev: any): string[] {
  // 업체 단위 노출 스위치가 꺼져 있으면 등록돼 있어도 안 내보낸다
  if (ev?.companies?.detail_images_visible === false) return []

  // 0) 업체가 제휴 포털에서 직접 올린 일정은 그 업체가 올린 이미지를 그대로 쓴다.
  //    크롤 일정과는 아예 다른 행이라(is_partner_direct) 유형 매칭이 끼어들 여지가 없다.
  if (ev?.is_partner_direct && ev?.detail_images?.length) return ev.detail_images

  // 1) 수동 지정 우선
  if (ev?.image_type?.images?.length) return ev.image_type.images

  // 2) 검색어 매칭 — 유형마다 admin에서 등록해 둔 검색어(match_keywords) 중 하나라도
  //    제목에 있으면 그 유형. 여러 유형이 걸리면 걸린 검색어가 가장 긴 쪽(더 구체적)이 이긴다.
  const title: string = (ev?.title ?? '').toLowerCase()
  if (!title) return []
  const types: any[] = ev?.companies?.company_image_types ?? []

  let best: { images: string[]; len: number } | null = null
  for (const t of types) {
    if (!t?.images?.length) continue
    const keywords: string[] = (t.match_keywords ?? []).map((k: any) => String(k).trim()).filter(Boolean)
    const hit = keywords
      .filter((k) => title.includes(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0]
    if (hit && (!best || hit.length > best.len)) best = { images: t.images, len: hit.length }
  }
  return best?.images ?? []
}

export function useEventDetail(id: string) {
  const [event, setEvent] = useState<EventWithCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEvent = useCallback(async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('events')
          .select('*, companies(id, name, plan, partner_benefit, logo_url, slug, base_url, description, is_active, detail_images_visible, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at, company_image_types(id, name, match_keywords, images, is_default, sort_order)), image_type:company_image_types!image_type_id(id, images)')
          .eq('id', id)
          .single()

        if (err) throw err

        const ev = data as any
        ev.descImages = resolveDescImages(ev)
        setEvent(ev as EventWithCompany)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '이벤트를 불러올 수 없습니다')
      } finally {
        setLoading(false)
      }
  }, [id])

  useEffect(() => { if (id) fetchEvent() }, [id, fetchEvent])

  return { event, loading, error, refetch: fetchEvent }
}
