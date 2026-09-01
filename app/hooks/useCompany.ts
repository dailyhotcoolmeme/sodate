import { useState, useEffect, useCallback} from 'react'
import { supabase, type CompanyRow, type EventWithCompany } from '@/lib/supabase'

interface CompanyWithEvents {
  company: CompanyRow
  events: EventWithCompany[]
}

export function useCompany(id: string) {
  const [data, setData] = useState<CompanyWithEvents | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCompany = useCallback(async () => {
      setLoading(true)
      setError(null)
      try {
        const [companyResult, eventsResult] = await Promise.all([
          supabase.from('companies').select('*').eq('id', id).single(),
          supabase
            .from('events')
            .select('*, companies(id, name, plan, logo_url, slug, base_url, description, is_active, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at)')
            .eq('company_id', id)
            .eq('is_active', true)
            // 마감(is_closed) 이벤트도 노출 — 카드에서 흐림+마감 배지 처리
            .gte('event_date', new Date().toISOString())
            .order('event_date', { ascending: true })
            .limit(20),
        ])

        if (companyResult.error) throw companyResult.error
        if (eventsResult.error) throw eventsResult.error

        setData({
          company: companyResult.data,
          events: (eventsResult.data ?? []) as EventWithCompany[],
        })
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '업체 정보를 불러올 수 없습니다')
      } finally {
        setLoading(false)
      }
  }, [id])

  useEffect(() => { if (id) fetchCompany() }, [id, fetchCompany])

  return { data, loading, error, refetch: fetchCompany }
}
