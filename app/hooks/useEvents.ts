import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase, type EventWithCompany } from '@/lib/supabase'
import { useFilterStore, useFilterHydrated } from '@/stores/filterStore'
import { useProfileStore } from '@/stores/profileStore'
import { AGE_GROUP_FILTERS } from '@/constants/ageGroups'
import { kstDowHour, timeSlotOf } from '@/constants/filters'

// 2026-07-26: 예전엔 .limit(100)으로 한 번에 끝까지 가져왔는데, 완성도 작업으로 활성
// 이벤트 총량이 685건까지 늘면서 100건(날짜 가까운 순)만 보이고 나머지 585건(85%)이
// 아예 안 불러와지던 사고 발견(오너 지적: "리스트가 7월31일꺼까지밖에 안나온다").
// 페이지네이션(스크롤시 추가 로드)으로 전환 — DB 부하도 한 번에 몰리지 않고 분산됨
// (마침 그날 Supabase Disk IO 예산 경고 메일도 받아 한 번에 다 끌어오는 걸 피하는 게 유리).
const PAGE_SIZE = 60

// 2026-08-07: select('*')가 피드 카드에서 안 쓰는 필드(특히 description — 평균 1,300자,
// 최대 6,000자 크롤 텍스트)까지 매번 끌고 와서 페이지당 응답이 258KB였다. 카드가 실제로
// 렌더에 쓰는 필드만 나열하니 51KB(-80%)로 줄었다(실측). 상세 페이지는 useEventDetail이
// 별도로 전체 컬럼을 다시 가져오니 여기서 빠진 필드가 있어도 상세 화면엔 영향 없다.
const FEED_COLUMNS =
  'id, company_id, title, thumbnail_urls, event_date, location_region, ' +
  'price_male, price_female, price_detail, age_male, age_female, theme, hashtags, ' +
  'is_closed, seats_left_male, seats_left_female, source_url, companies!inner(id, name, slug)'

// 2026-08-07: 앱을 새로 열 때마다 첫 화면이 빈 스피너로 시작했다. 마지막으로 본 첫 페이지를
// 기기에 저장해뒀다가, 같은 필터 조합으로 다시 열면 그 캐시를 즉시 보여주고(스피너 생략)
// 뒤에서 조용히 최신 데이터로 갱신한다. 필터가 하나라도 다르면 캐시를 안 쓴다.
const CACHE_KEY = 'sodate-events-cache-v1'
const CACHE_MAX_AGE_MS = 10 * 60 * 1000 // 10분 — 가격 변동·마감 등 실시간성 때문에 그 이상은 안 믿는다

async function readEventsCache(key: string): Promise<EventWithCompany[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { key: string; savedAt: number; events: EventWithCompany[] }
    if (parsed.key !== key) return null
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null
    return parsed.events
  } catch {
    return null
  }
}

function writeEventsCache(key: string, events: EventWithCompany[]) {
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ key, savedAt: Date.now(), events })).catch(() => {})
}

export function useEvents() {
  const [events, setEvents] = useState<EventWithCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageRef = useRef(0)
  const didInitialLoad = useRef(false)

  const hydrated = useFilterHydrated()
  const { regions, dateRange, maxPrice, themes, hashtags, ageGroups, days, timeSlots, companies, sortBy, excludeClosed } = useFilterStore()
  const { myAge, myGender } = useProfileStore()

  // 캐시를 구분하는 키 — buildQuery·applyClientFilters가 실제로 참조하는 필터 전부를 담는다.
  const cacheKey = useMemo(() => JSON.stringify({
    regions, dateRange, maxPrice, themes, hashtags, ageGroups, days, timeSlots, companies, sortBy, excludeClosed, myAge,
  }), [regions, dateRange, maxPrice, themes, hashtags, ageGroups, days, timeSlots, companies, sortBy, excludeClosed, myAge])

  const buildQuery = useCallback((from: number, to: number) => {
    let query = supabase
      .from('events')
      // 피드는 카드 렌더에 쓰는 필드만(위 FEED_COLUMNS 주석 참고)
      // companies!inner + app_visible: 앱 숨김 처리한 업체(admin 토글)의 이벤트는 완전 제외
      .select(FEED_COLUMNS)
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

    return query.range(from, to)
  }, [regions, dateRange, maxPrice, themes, hashtags, ageGroups, companies, sortBy, excludeClosed, myAge])

  // 요일·시간대는 KST 기준 클라이언트 필터 (서버에서 dow/hour 직접 못 거름)
  const applyClientFilters = useCallback((rows: EventWithCompany[]) => {
    if (days.length === 0 && timeSlots.length === 0) return rows
    return rows.filter((e) => {
      const { dow, hour } = kstDowHour(e.event_date)
      if (days.length > 0 && !days.includes(dow)) return false
      if (timeSlots.length > 0 && !timeSlots.includes(timeSlotOf(hour))) return false
      return true
    })
  }, [days, timeSlots])

  // opts.silent: 화면엔 이미 캐시된 목록이 보이는 상태에서 뒤에서 조용히 최신화할 때 씀
  // (스피너를 다시 띄우지 않고, 실패해도 이미 보이는 화면을 에러로 덮지 않음).
  const fetchEvents = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError(null)
    pageRef.current = 0

    try {
      const { data, error: err } = await buildQuery(0, PAGE_SIZE - 1)
      if (err) throw err
      const rows = applyClientFilters((data ?? []) as EventWithCompany[])
      setEvents(rows)
      setHasMore((data ?? []).length === PAGE_SIZE)
      writeEventsCache(cacheKey, rows)
    } catch (e: unknown) {
      if (!opts?.silent) setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [buildQuery, applyClientFilters, cacheKey])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const nextPage = pageRef.current + 1
      const from = nextPage * PAGE_SIZE
      const { data, error: err } = await buildQuery(from, from + PAGE_SIZE - 1)
      if (err) throw err
      pageRef.current = nextPage
      const rows = applyClientFilters((data ?? []) as EventWithCompany[])
      setEvents((prev) => [...prev, ...rows])
      setHasMore((data ?? []).length === PAGE_SIZE)
    } catch {
      // 추가 로드 실패는 조용히 무시(첫 페이지는 이미 보이는 상태 유지) — 스크롤 끝에서
      // 계속 시도하면 다음 onEndReached에서 재시도됨
    } finally {
      setLoadingMore(false)
    }
  }, [buildQuery, applyClientFilters, loading, loadingMore, hasMore])

  useEffect(() => {
    // 필터(AsyncStorage persist)가 아직 안 불러와진 상태에서 쏘면 기본값(전체)으로 한 번,
    // 하이드레이션 완료 후 실제 값으로 또 한 번 — 매번 앱을 켤 때마다 요청이 두 번 나갔다.
    // 하이드레이션 끝날 때까지 기다렸다가 그때 딱 한 번만 쏜다.
    if (!hydrated) return

    if (!didInitialLoad.current) {
      didInitialLoad.current = true
      let cancelled = false
      ;(async () => {
        const cached = await readEventsCache(cacheKey)
        if (cancelled) return
        if (cached) {
          // 캐시 즉시 표시(스피너 없이) + 뒤에서 조용히 최신화
          setEvents(cached)
          setLoading(false)
          fetchEvents({ silent: true })
        } else {
          fetchEvents()
        }
      })()
      return () => { cancelled = true }
    }

    // 최초 로드 이후 필터가 바뀌어서 다시 도는 경우는 기존과 동일하게 동작
    fetchEvents()
  }, [hydrated, fetchEvents, cacheKey])

  return { events, loading, loadingMore, hasMore, error, refetch: fetchEvents, loadMore }
}
