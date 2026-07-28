import { useState, useEffect } from 'react'
import { supabase, type EventWithCompany } from '@/lib/supabase'

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
          .select('*, companies(id, name, logo_url, slug, base_url, description, is_active, detail_images_visible, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at, company_image_types(id, images, is_default, sort_order)), image_type:company_image_types!image_type_id(id, images)')
          .eq('id', id)
          .single()

        if (err) throw err

        // 상세 설명 이미지 해석: 일정에 지정된 유형 → 없으면 업체 기본 유형 → 없으면 빈 배열(섹션 숨김)
        // 업체의 detail_images_visible이 꺼져 있으면 이미지가 등록돼 있어도 내보내지 않는다
        // (admin에서 이미지를 지우지 않고 잠시 내리는 스위치. 지우면 재업로드해야 하므로)
        const ev = data as any
        let descImages: string[] = []
        if (ev.companies?.detail_images_visible === false) {
          descImages = []
        } else if (ev.image_type?.images?.length) {
          descImages = ev.image_type.images
        } else {
          const types = ev.companies?.company_image_types ?? []
          const def =
            types.find((t: any) => t.is_default) ??
            [...types].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
          if (def?.images?.length) descImages = def.images
        }
        ev.descImages = descImages
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
