import { useState, useEffect, useCallback } from 'react'
import { supabase, type EventWithCompany } from '@/lib/supabase'
import { useFilterStore } from '@/stores/filterStore'
import { useProfileStore } from '@/stores/profileStore'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'

export function useEvents() {
  const [events, setEvents] = useState<EventWithCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { region, dateRange, maxPrice, themes, ageGroup, sortBy } = useFilterStore()
  const { myAge, myGender } = useProfileStore()

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('events')
        .select('*, companies(id, name, logo_url, slug, base_url, description, is_active, crawl_url, crawl_type, regions, instagram_url, created_at, updated_at)')
        .eq('is_active', true)
        .eq('is_closed', false)
        .gte('event_date', new Date().toISOString())

      // 지역 필터
      if (region !== 'all') {
        query = query.eq('location_region', region)
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

      // 나이대 필터
      if (ageGroup !== 'all') {
        const ageFilter = AGE_GROUP_FILTERS.find((a) => a.id === ageGroup)
        if (ageFilter && ageFilter.min !== undefined && ageFilter.max !== undefined) {
          // 이벤트의 나이 범위와 필터 범위가 겹치는 것만 표시
          // 이벤트 범위 [age_range_min, age_range_max]가 필터 범위 [min, max]와 overlap
          query = query
            .lte('age_range_min', ageFilter.max)
            .or(`age_range_max.gte.${ageFilter.min},age_range_max.is.null`)
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
      setEvents((data ?? []) as EventWithCompany[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [region, dateRange, maxPrice, themes, ageGroup, sortBy, myAge, myGender])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  return { events, loading, error, refetch: fetchEvents }
}
