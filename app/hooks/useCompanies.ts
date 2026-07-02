import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export type CompanyOption = { id: string; name: string }

// 활성·미래 이벤트가 있는 업체 목록 (필터 칩용). 이벤트 많은 순.
export function useCompanies(): CompanyOption[] {
  const [companies, setCompanies] = useState<CompanyOption[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('events')
        .select('company_id, companies(name)')
        .eq('is_active', true)
        .gte('event_date', new Date().toISOString())
      if (!alive || !data) return
      const counts: Record<string, { name: string; n: number }> = {}
      for (const e of data as { company_id: string; companies: { name?: string } | null }[]) {
        if (!e.company_id) continue
        const name = e.companies?.name ?? e.company_id
        if (!counts[e.company_id]) counts[e.company_id] = { name, n: 0 }
        counts[e.company_id].n++
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1].n - a[1].n)
        .map(([id, v]) => ({ id, name: v.name }))
      setCompanies(sorted)
    })()
    return () => {
      alive = false
    }
  }, [])

  return companies
}
