import { useState, useEffect } from 'react'
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

  // 1) 수동 지정 우선
  if (ev?.image_type?.images?.length) return ev.image_type.images

  // 2) 이름 매칭
  const title: string = (ev?.title ?? '').toLowerCase()
  if (!title) return []
  const types: any[] = ev?.companies?.company_image_types ?? []
  const matched = types
    .filter((t) => {
      const n = String(t?.name ?? '').trim().toLowerCase()
      return n.length > 0 && t?.images?.length && title.includes(n)
    })
    .sort((a, b) => String(b.name).trim().length - String(a.name).trim().length)

  return matched[0]?.images ?? []
}

export function useEventDetail(id: string) {
  const [event, setEvent] = useState<EventWithCompany | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchEvent() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('events')
          .select('*, companies(id, name, logo_url, slug, base_url, description, is_active, detail_images_visible, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at, company_image_types(id, name, images, is_default, sort_order)), image_type:company_image_types!image_type_id(id, images)')
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
    }

    if (id) fetchEvent()
  }, [id])

  return { event, loading, error }
}
