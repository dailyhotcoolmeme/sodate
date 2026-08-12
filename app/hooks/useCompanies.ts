import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

export type CompanyOption = { id: string; name: string }

const COMPANY_CACHE_KEY = 'sodate-companies-cache'

// 활성·미래 이벤트가 있는 업체 목록 (필터 칩용). 이벤트 많은 순.
// 캐시 우선 → DB 최신으로 갱신. 콜드스타트 때 id→이름 해석이 늦어 필터칩에
// UUID가 잠깐 보이던 문제 방지(캐시가 있으면 즉시 이름으로 뜸).
export function useCompanies(): CompanyOption[] {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const gotFresh = useRef(false)

  useEffect(() => {
    let alive = true
    // 1) 캐시 먼저 즉시 표시. DB 응답 오면 덮어씀.
    AsyncStorage.getItem(COMPANY_CACHE_KEY).then((raw) => {
      if (!alive || gotFresh.current || !raw) return
      try {
        setCompanies(JSON.parse(raw))
      } catch {}
    })
    // 2) DB 최신 조회 → 갱신 + 캐시 저장
    ;(async () => {
      // companies!inner + app_visible: 앱 숨김 업체는 필터 칩에도 안 나오게 제외
      // 1000행 상한에 걸리면 뒤쪽에만 있는 업체가 칩에서 사라진다(useRegions 와 같은 이유).
      const PAGE = 1000
      const data: any[] = []
      try {
        for (let from = 0; ; from += PAGE) {
          const res = await supabase
            .from('events')
            .select('company_id, companies!inner(name)')
            .eq('is_active', true)
            .eq('companies.app_visible', true)
            .gte('event_date', new Date().toISOString())
            .range(from, from + PAGE - 1)
          if (!alive) return
          if (res.data) data.push(...res.data)
          if (!res.data || res.data.length < PAGE) break
        }
      } catch {
        return // 네트워크 실패 시 캐시된 목록 유지(unhandled rejection 방지)
      }
      if (!alive || !data.length) return
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
      gotFresh.current = true
      setCompanies(sorted)
      AsyncStorage.setItem(COMPANY_CACHE_KEY, JSON.stringify(sorted)).catch(() => {})
    })()
    return () => {
      alive = false
    }
  }, [])

  return companies
}
