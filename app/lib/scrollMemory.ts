/**
 * 화면(피드) 스크롤 위치 기억 — 다른 탭(바텀내비) 갔다가 돌아와도 보던 위치 그대로
 * (2026-08-25 오너 지시: "다른 페이지 갔다가 돌아올때 피드 위치 유지되어야 한다").
 *
 * 지금 탭 전환이 router.replace라 화면이 완전히 새로 마운트된다(같은 컴포넌트 인스턴스가
 * 안 이어짐) — FlatList 자체의 스크롤 상태도 같이 사라진다. AsyncStorage까지는 필요 없고
 * (앱을 껐다 켰을 때까지 유지할 필요는 없음), 앱이 켜져 있는 동안만 기억하면 되므로 그냥
 * 모듈 전역 변수로 충분하다.
 */
const offsets = new Map<string, number>()

export function saveScrollOffset(key: string, y: number): void {
  offsets.set(key, y)
}

export function getScrollOffset(key: string): number {
  return offsets.get(key) ?? 0
}
