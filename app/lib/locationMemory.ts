/**
 * 혼술바 "현재 위치"(거리순 정렬용) 기억 — 탭 전환마다 화면이 통째로 새로 마운트되면서
 * 로컬 useState 였던 좌표도 매번 null 로 리셋됐다. 정렬 기준(거리순)은 스토어에 남아
 * "거리순" 칩은 계속 켜져 보이는데 실제 좌표가 없어 정렬은 조용히 풀려 있었다
 * (2026-08-25 오너 지적: "현재위치를 계속 물고 있을순 없나?").
 *
 * scrollMemory·tabMemory 와 같은 이유로 AsyncStorage까지는 필요 없다 — 앱을 껐다 켰을
 * 때까지 유지할 값은 아니고(그땐 새로 재는 게 맞다), 같은 앱 실행 동안만 유지하면 된다.
 */
let cached: { lat: number; lng: number } | null = null

export function getCachedLocation(): { lat: number; lng: number } | null {
  return cached
}

export function setCachedLocation(loc: { lat: number; lng: number } | null): void {
  cached = loc
}
