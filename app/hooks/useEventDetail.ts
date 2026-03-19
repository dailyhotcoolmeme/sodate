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
          .select('*, companies(id, name, logo_url, slug, base_url, description, is_active, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at)')
          .eq('id', id)
          .single()

        if (err) throw err
        setEvent(data as EventWithCompany)
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
