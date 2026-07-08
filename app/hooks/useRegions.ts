import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

export type RegionOption = { id: string; label: string }

const REGION_CACHE_KEY = 'sodate-regions-cache'

// 서울·수도권으로 보는 지역들
const SEOUL_METRO = new Set([
  '서울', '강남', '역삼', '홍대', '신촌', '을지로', '이태원', '성수', '잠실', '종로',
  '동작', '건대', '강북', '강서', '송파', '마포', '영등포', '여의도', '강동', '노원',
  '수원', '인천', '분당', '판교', '일산', '부천', '안양', '성남', '고양', '광교', '동탄',
])

// 정렬 그룹: 서울·수도권(0) → 그 외 지방(1) → 기타(2, 맨 끝)
function rankOf(region: string): number {
  if (region === '기타') return 2
  if (SEOUL_METRO.has(region)) return 0
  return 1
}

// 실제 크롤링된(활성·미래) 이벤트의 지역을 그대로 필터칩으로 — 항상 데이터와 일치.
// 순서: 서울·수도권 먼저(서울 최우선) → 지방 → 기타 끝. 그룹 안에서는 건수 많은 순. '미정' 제외.
// 다중 선택이라 '전체' 칩은 없음(아무것도 안 고르면 전체).
export function useRegions(): RegionOption[] {
  const [regions, setRegions] = useState<RegionOption[]>([])
  const gotFresh = useRef(false)

  useEffect(() => {
    let alive = true
    // 1) 캐시 먼저 즉시 표시(칩 늦게 뜨는 것 방지). DB 응답 오면 덮어씀.
    AsyncStorage.getItem(REGION_CACHE_KEY).then((raw) => {
      if (!alive || gotFresh.current || !raw) return
      try {
        setRegions(JSON.parse(raw))
      } catch {}
    })
    // 2) DB 최신 조회 → 갱신 + 캐시 저장
    ;(async () => {
      const { data } = await supabase
        .from('events')
        .select('location_region')
        .eq('is_active', true)
        .gte('event_date', new Date().toISOString())
      if (!alive || !data) return
      const counts: Record<string, number> = {}
      for (const e of data) {
        const r = (e as { location_region?: string }).location_region
        if (r && r !== '미정') counts[r] = (counts[r] ?? 0) + 1
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => {
          const ra = rankOf(a[0]), rb = rankOf(b[0])
          if (ra !== rb) return ra - rb
          if (a[0] === '서울') return -1
          if (b[0] === '서울') return 1
          return b[1] - a[1] // 같은 그룹: 건수 많은 순
        })
        .map(([r]) => ({ id: r, label: r }))
      gotFresh.current = true
      setRegions(sorted)
      AsyncStorage.setItem(REGION_CACHE_KEY, JSON.stringify(sorted)).catch(() => {})
    })()
    return () => {
      alive = false
    }
  }, [])

  return regions
}
