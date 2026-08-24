/**
 * 탭(바텀내비 5개 구역)별 "마지막으로 보던 화면" 기억 — 상세페이지를 보다가 다른 탭
 * 갔다 그 탭으로 돌아오면 목록(피드)이 아니라 보던 상세페이지 그대로 나와야 한다
 * (2026-08-25 오너 지적: "상세페이지 보기 상태에서 다른 메뉴 갔다가 돌아오면 상세페이지가
 * 아니라 피드화면으로 넘어간다"). BottomNav.tsx 가 매 화면 마운트마다 자기 경로를 여기
 * 저장하고, 탭을 누를 때 고정된 인덱스 경로 대신 여기 저장된 경로로 이동한다.
 *
 * scrollMemory 와 같은 이유로 세션 전역 변수면 충분 — 앱을 껐다 켰을 때까지 유지할 필요 없음.
 */
const lastRoute = new Map<string, string>()

export function saveTabRoute(tab: string, pathname: string): void {
  lastRoute.set(tab, pathname)
}

export function getTabRoute(tab: string): string | undefined {
  return lastRoute.get(tab)
}
