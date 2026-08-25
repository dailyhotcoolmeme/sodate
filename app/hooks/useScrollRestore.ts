import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlatList } from 'react-native'
import { getScrollOffset } from '@/lib/scrollMemory'

/**
 * 피드 스크롤 위치 복원(2026-08-25, 세 번째 재설계).
 *
 * 예전 방식(한 번만 판정): "목표 위치+여유(300px)만큼 콘텐츠가 자랐다" 싶은 순간에
 * 딱 한 번만 scrollToOffset 을 쐈다. 근데 그 "자랐다" 판정 시점 자체가 기기·타이밍마다
 * 들쭉날쭉해서(레이아웃이 막 끝난 찰나 vs 조금 더 있다 이미지가 로딩되며 다시 밀리는
 * 경우 등) 어떤 땐 맞고 어떤 땐 안 맞았다(오너: "혼술바도 어쩔땐 위치가 맞고 어쩔땐
 * 안맞고"). 페이지네이션 목록(소개팅·소셜링)은 여기에 더해 "화면에 스크롤이 안 닿으면
 * 다음 페이지가 저절로 안 불러와진다"는 문제까지 겹쳤다(소셜링: "위치를 이동후에 다른
 * 페이지 갔다오면 처음 정한위치만 나온다").
 *
 * 새 방식: 판정을 아예 안 한다. onContentSizeChange 가 불릴 때마다(콘텐츠가 조금이라도
 * 자랄 때마다) 매번 다시 scrollToOffset 을 쏜다 — 아직 목표에 못 미치면 갈 수 있는
 * 데까지 가고, 다음 호출에서 더 자라 있으면 또 더 간다. "됐다"고 확정하는 기준도
 * 높이 하나가 아니라 "두 번 연속 높이가 안 바뀜"(=레이아웃이 진짜로 안정됐다)으로
 * 바꿔서, 이미지 등이 뒤늦게 로딩되며 밀리는 것도 스스로 다시 잡는다.
 */
export function useScrollRestore<T>(
  key: string,
  listRef: React.RefObject<FlatList<T> | null>,
  opts: { hasMore?: boolean; loadMore?: () => void; revealTimeoutMs?: number } = {},
) {
  const restoredRef = useRef(false)
  const lastHRef = useRef(-1)
  const stableCountRef = useRef(0)
  const [listVisible, setListVisible] = useState(() => getScrollOffset(key) <= 0)

  useEffect(() => {
    const t = setTimeout(() => setListVisible(true), opts.revealTimeoutMs ?? 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 복원이 끝나기 전에 사용자가 직접(손가락으로) 스크롤을 시작하면 그걸로 끝 —
  // 나중에 콘텐츠가 더 쌓여도 되돌리지 않는다. onScroll(프로그램적 스크롤 포함)이 아니라
  // onScrollBeginDrag(진짜 드래그만 발생)로 판정해야, 우리가 쏘는 scrollToOffset 자체가
  // "사용자가 스크롤함"으로 잘못 판정되는 경쟁 상태가 안 생긴다.
  const onScrollBeginDrag = useCallback(() => {
    restoredRef.current = true
    setListVisible(true)
  }, [])

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    if (restoredRef.current) return
    const y = getScrollOffset(key)
    if (y <= 0) { restoredRef.current = true; setListVisible(true); return }

    listRef.current?.scrollToOffset({ offset: y, animated: false })

    if (h === lastHRef.current) {
      stableCountRef.current += 1
    } else {
      stableCountRef.current = 0
      lastHRef.current = h
      // 페이지네이션 목록은 화면에 안 닿으면 onEndReached 가 저절로 안 불려서, 목표
      // 위치까지 아직 부족하면 직접 다음 페이지를 불러온다.
      if (h < y + 300 && opts.hasMore) opts.loadMore?.()
    }

    if (stableCountRef.current >= 2) {
      restoredRef.current = true
      requestAnimationFrame(() => setListVisible(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.hasMore])

  return { restoredRef, listVisible, onScrollBeginDrag, onContentSizeChange }
}
