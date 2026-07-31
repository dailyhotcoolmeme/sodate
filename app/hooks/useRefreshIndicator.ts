import { useCallback, useEffect, useRef, useState } from 'react'

/** 당김 표시를 최소한 이만큼은 보여준다 */
const MIN_VISIBLE_MS = 700

/**
 * 당겨서 새로고침용 상태와 손잡이.
 *
 * 두 가지를 지킨다.
 *
 * 1. **당김 표시는 사용자가 당겼을 때만 나온다.** 화면에 처음 들어올 때 데이터를
 *    불러오는 건 화면 자체의 로딩 표시가 맡는다. 둘을 같은 값으로 묶으면 진입할
 *    때마다 당김 스피너가 튀어나온다 — 다른 앱은 그러지 않는다.
 * 2. **표시는 최소 0.7초 유지한다.** 우리 서버는 0.2초면 응답해서, 그대로 두면
 *    표시가 뜨자마자 사라져 당긴 게 먹었는지 알 수가 없다.
 *
 * 당기는 거리 자체는 iOS 가 정한 값을 그대로 쓴다(`UIRefreshControl`). 리액트
 * 네이티브가 바꿀 수 있는 설정이 없고(progressViewOffset 은 iOS 미동작, RN #54183),
 * 메일·사파리와 같아야 맞다.
 */
export function useRefreshIndicator(loading: boolean, refetch: () => void) {
  const [refreshing, setRefreshing] = useState(false)
  const startedAt = useRef(0)
  const pulled = useRef(false)

  const onRefresh = useCallback(() => {
    pulled.current = true
    startedAt.current = Date.now()
    setRefreshing(true)
    refetch()
  }, [refetch])

  // 당겨서 시작한 새로고침이 끝나면, 최소 시간을 채운 뒤에 표시를 거둔다.
  useEffect(() => {
    if (!pulled.current || loading) return
    const left = MIN_VISIBLE_MS - (Date.now() - startedAt.current)
    const done = () => { pulled.current = false; setRefreshing(false) }
    if (left <= 0) { done(); return }
    const t = setTimeout(done, left)
    return () => clearTimeout(t)
  }, [loading])

  return { refreshing, onRefresh }
}
