import { useEffect, useRef, useState } from 'react'

/** 당김 표시를 최소한 이만큼은 보여준다 */
const MIN_VISIBLE_MS = 700

/**
 * 당겨서 새로고침 표시용 상태.
 *
 * 당기는 거리는 iOS 가 정한 값을 그대로 쓴다(`UIRefreshControl`). 리액트 네이티브가
 * 바꿀 수 있는 설정이 없고, 바꿀 이유도 없다 — 메일·사파리와 같은 거리라야 한다.
 *
 * 대신 표시가 남아 있는 시간은 맞춰준다. 우리 서버는 0.2초면 응답해서 표시가 뜨자마자
 * 사라지는데, 그러면 당긴 게 먹었는지 알 수가 없다. 다른 앱들처럼 잠깐 붙잡아 둔다.
 */
export function useRefreshIndicator(loading: boolean): boolean {
  const [visible, setVisible] = useState(loading)
  const startedAt = useRef(0)

  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now()
      setVisible(true)
      return
    }
    const left = MIN_VISIBLE_MS - (Date.now() - startedAt.current)
    if (left <= 0) { setVisible(false); return }
    const t = setTimeout(() => setVisible(false), left)
    return () => clearTimeout(t)
  }, [loading])

  return visible
}
