import { useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'

export type RegionOption = { id: string; label: string }

const REGION_CACHE_KEY = 'sodate-regions-cache'
const REGION_CACHE_KEY_SOC = 'sodate-regions-cache-socialing'

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
//
// ⚠️(2026-08-24 오너 지적: "소개팅 필터랑 소셜링 필터가 똑같은거야?") 예전엔 event_type
// 구분 없이 전체 이벤트에서 지역을 뽑아 소개팅·소셜링 필터가 완전히 같은 목록을 보여줬다
// (그래서 서로 안 쓰는 지역이 섞여 들어와 '기타'도 불필요하게 커졌다). eventType 을 넘기면
// 그 종류의 이벤트에서만 지역을 뽑는다.
export function useRegions(eventType?: 'dating' | 'socialing'): RegionOption[] {
  const [regions, setRegions] = useState<RegionOption[]>([])
  const gotFresh = useRef(false)
  const cacheKey = eventType === 'socialing' ? REGION_CACHE_KEY_SOC : REGION_CACHE_KEY

  useEffect(() => {
    let alive = true
    gotFresh.current = false
    // 1) 캐시 먼저 즉시 표시(칩 늦게 뜨는 것 방지). DB 응답 오면 덮어씀.
    AsyncStorage.getItem(cacheKey).then((raw) => {
      if (!alive || gotFresh.current || !raw) return
      try {
        setRegions(JSON.parse(raw))
      } catch {}
    })
    // 2) DB 최신 조회 → 갱신 + 캐시 저장
    ;(async () => {
      // PostgREST 는 한 번에 1000행까지만 준다. 활성·미래 일정이 그 근처(2026-08-13
      // 기준 997건)라 곧 넘어가는데, 넘는 순간 뒤쪽에만 있는 지역이 칩에서 통째로
      // 사라진다(정렬도 지정 안 해 어느 행이 잘릴지 비결정적). useHashtags 와 같은
      // 방식으로 끝까지 나눠 받는다.
      const PAGE = 1000
      const rows: { location_region?: string }[] = []
      for (let from = 0; ; from += PAGE) {
        let query = supabase
          .from('events')
          .select('location_region')
          .eq('is_active', true)
          .gte('event_date', new Date().toISOString())
        // 소개팅 쪽은 event_type이 비어있는 옛 행도 소개팅으로 본다(다른 화면들과 같은 규칙).
        query = eventType === 'socialing' ? query.eq('event_type', 'socialing') : query.neq('event_type', 'socialing')
        const { data } = await query.range(from, from + PAGE - 1)
        if (!alive) return
        if (data) rows.push(...(data as { location_region?: string }[]))
        if (!data || data.length < PAGE) break
      }
      if (!rows.length) return
      const counts: Record<string, number> = {}
      for (const e of rows) {
        const r = e.location_region
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
      AsyncStorage.setItem(cacheKey, JSON.stringify(sorted)).catch(() => {})
    })()
    return () => {
      alive = false
    }
  }, [cacheKey, eventType])

  return regions
}
