import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useFavoriteStore } from '@/stores/favoriteStore'

/**
 * 관심(찜) 상태. 실제 상태는 전역 스토어(stores/favoriteStore)에 있고 여기선 꺼내 쓰기만 한다.
 *
 * 예전엔 이 훅이 화면마다 자기 useState 를 들고 있어서 화면끼리 값이 어긋났다
 * (상세에서 찜해도 이미 떠 있던 피드에는 반영 안 됨 — 2026-07-28 실기기 확인).
 * 호출부는 그대로 두려고 반환 모양은 유지한다.
 */
export function useFavorites() {
  const favoriteIds = useFavoriteStore((s) => s.favoriteIds)
  const toggle = useFavoriteStore((s) => s.toggle)
  const loading = useFavoriteStore((s) => s.loading)
  const deviceId = useFavoriteStore((s) => s.deviceId)
  const init = useFavoriteStore((s) => s.init)

  useEffect(() => { init() }, [init])

  return { favoriteIds, toggle, loading, deviceId }
}

export function useFavoriteEvents() {
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedOnce = useRef(false)
  const { deviceId, favoriteIds } = useFavorites()

  const fetchFavorites = useCallback(async () => {
    if (!deviceId) return
    // 첫 로드에서만 스피너를 띄운다. 찜을 껐다 켤 때마다 스피너가 뜨면 목록이 통째로
    // 사라졌다 다시 그려져 "느리다"고 느껴진다(2026-07-28 오너 지적).
    if (!loadedOnce.current) setLoading(true)
    setError(null)
    try {
      // 이벤트+업체를 조인해 jsonb 배열로 돌려주는 스코핑 RPC(테이블 직접 접근은 차단됨).
      const { data, error: err } = await supabase.rpc('get_my_favorite_events' as any, {
        p_device_id: deviceId,
      } as any)
      if (err) throw err
      setEvents((data ?? []) as any[])
    } catch (e: unknown) {
      // 예전엔 실패해도 빈 배열이라 "찜한 게 없음"과 구분이 안 돼, 사용자는 찜이
      // 사라진 줄 알았다. 에러를 분리해 화면에서 재시도를 띄운다.
      setError(e instanceof Error ? e.message : '불러오지 못했어요')
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
  }, [deviceId])

  useEffect(() => { fetchFavorites() }, [fetchFavorites])

  // 찜이 "늘어났을 때만" 서버를 다시 본다(다른 화면에서 새로 담은 항목을 받아오려고).
  // 해제는 아래 화면단 필터로 즉시 반영되므로 네트워크를 탈 필요가 없다.
  const knownIds = events.length
  useEffect(() => {
    if (loadedOnce.current && favoriteIds.size > knownIds) fetchFavorites()
  }, [favoriteIds.size, knownIds, fetchFavorites])

  // 해제는 서버 응답을 기다리지 않고 그 자리에서 목록에서 빠진다.
  const visible = useMemo(
    () => events.filter((e) => favoriteIds.has(e.id)),
    [events, favoriteIds],
  )

  return { events: visible, loading, error, refetch: fetchFavorites }
}
