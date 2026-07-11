import { useState, useEffect, useCallback } from 'react'
import { supabase, type EventWithCompany } from '@/lib/supabase'
import { useFilterStore } from '@/stores/filterStore'
import { useProfileStore } from '@/stores/profileStore'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { kstDowHour, timeSlotOf } from '@/constants/filters'

export function useEvents() {
  const [events, setEvents] = useState<EventWithCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { regions, dateRange, maxPrice, themes, hashtags, ageGroups, days, timeSlots, companies, sortBy, excludeClosed } = useFilterStore()
  const { myAge, myGender } = useProfileStore()

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('events')
        // 피드는 companies.name만 사용 → 조인 최소화(불필요한 description 등 미포함, 페이로드↓)
        // companies!inner + app_visible: 앱 숨김 처리한 업체(admin 토글)의 이벤트는 완전 제외
        .select('*, companies!inner(id, name, slug)')
        .eq('is_active', true)
        .eq('companies.app_visible', true)
        // 마감(is_closed) 이벤트도 기본은 목록 노출(카드 흐림+마감배지). '마감제외' 켜면 숨김.
        .gte('event_date', new Date().toISOString())
        // 당일 ~ +1달 하드 상한: 1달 넘는 미래 이벤트는 항상 제외 (매일 자동 롤링)
        .lte('event_date', (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString() })())

      // 지역 필터 (다중 선택)
      if (regions.length > 0) {
        query = query.in('location_region', regions)
      }

      // 업체 필터 (다중 선택)
      if (companies.length > 0) {
        query = query.in('company_id', companies)
      }

      // 마감 제외 — is_closed=true 인 이벤트 숨김 (null/false=미마감은 표시)
      if (excludeClosed) {
        query = query.or('is_closed.is.null,is_closed.eq.false')
      }

      // 날짜 필터
      const now = new Date()
      if (dateRange === 'today') {
        const end = new Date(now)
        end.setHours(23, 59, 59, 999)
        query = query.lte('event_date', end.toISOString())
      } else if (dateRange === 'week') {
        const end = new Date(now)
        end.setDate(end.getDate() + 7)
        query = query.lte('event_date', end.toISOString())
      } else if (dateRange === 'month') {
        const end = new Date(now)
        end.setMonth(end.getMonth() + 1)
        query = query.lte('event_date', end.toISOString())
      }

      // 가격 필터
      if (maxPrice !== null) {
        query = query.or(
          `price_male.lte.${maxPrice},price_female.lte.${maxPrice}`
        )
      }

      // 테마 필터 (theme is string[] in DB)
      if (themes.length > 0) {
        query = query.overlaps('theme', themes)
      }

      // 해시태그 필터 (hashtags is string[] in DB) — OR: 선택 태그 중 하나라도 포함하면 표시
      if (hashtags.length > 0) {
        query = query.overlaps('hashtags', hashtags)
      }

      // 나이대 필터 (다중 선택) — 선택한 구간 중 하나라도 겹치면 표시
      if (ageGroups.length > 0) {
        const buckets = AGE_GROUP_FILTERS.filter((a) => ageGroups.includes(a.id))
        if (buckets.length > 0) {
          // 각 구간과 overlap: age_range_min <= 구간max AND (age_range_max >= 구간min OR null)
          const orStr = buckets
            .map((b) => `and(age_range_min.lte.${b.max},or(age_range_max.gte.${b.min},age_range_max.is.null))`)
            .join(',')
          query = query.or(orStr)
        }
      }

      // 내 나이 필터 (내 나이가 이벤트 나이 범위 안에 드는 것만)
      if (myAge !== null) {
        query = query
          .or(`age_range_min.is.null,age_range_min.lte.${myAge}`)
          .or(`age_range_max.is.null,age_range_max.gte.${myAge}`)
      }

      // 정렬
      if (sortBy === 'created') {
        query = query.order('created_at', { ascending: false })
      } else if (sortBy === 'price_low') {
        query = query.order('price_male', { ascending: true, nullsFirst: false })
      } else if (sortBy === 'price_high') {
        query = query.order('price_male', { ascending: false, nullsFirst: false })
      } else {
        query = query.order('event_date', { ascending: true })
      }

      const { data, error: err } = await query.limit(100)
      if (err) throw err

      // 요일·시간대는 KST 기준 클라이언트 필터 (서버에서 dow/hour 직접 못 거름)
      let rows = (data ?? []) as EventWithCompany[]
      if (days.length > 0 || timeSlots.length > 0) {
        rows = rows.filter((e) => {
          const { dow, hour } = kstDowHour(e.event_date)
          if (days.length > 0 && !days.includes(dow)) return false
          if (timeSlots.length > 0 && !timeSlots.includes(timeSlotOf(hour))) return false
          return true
        })
      }
      setEvents(rows)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [regions, dateRange, maxPrice, themes, hashtags, ageGroups, days, timeSlots, companies, sortBy, excludeClosed, myAge, myGender])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  return { events, loading, error, refetch: fetchEvents }
}
