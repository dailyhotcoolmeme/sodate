import { AppState } from 'react-native'
import * as Updates from 'expo-updates'

// 앱을 강제로 안 껐다 켜면 OTA가 다음 실행까지 반영 안 된다 — 포그라운드로 돌아올 때마다
// 새 업데이트가 있는지 확인해서 있으면 바로 반영한다(2026-08-14 오너 지시: 게시판 글이
// 옛 번들 때문에 안 보이는 것처럼 보인 사례가 계기).
//
// 단, 글쓰기/수정 화면에 입력 중인 내용이 있을 때 강제로 새로고침하면 그 내용이 날아간다
// (Updates.reloadAsync()는 JS 런타임을 통째로 다시 시작). board/write.tsx가 setUpdateHold로
// 알려주면 그동안은 반영을 미루고, 화면을 벗어나거나 등록하는 순간 즉시 반영한다.
let holding = false
let pendingReload = false

export function setUpdateHold(held: boolean): void {
  holding = held
  if (!held && pendingReload) {
    pendingReload = false
    Updates.reloadAsync().catch(() => {})
  }
}

async function checkAndApplyUpdate(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) return
  try {
    const check = await Updates.checkForUpdateAsync()
    if (!check.isAvailable) return
    await Updates.fetchUpdateAsync()
    if (holding) {
      pendingReload = true
      return
    }
    await Updates.reloadAsync()
  } catch {
    // 네트워크 실패 등은 조용히 무시 — 다음 포그라운드 전환 때 다시 시도된다
  }
}

/** 앱 최상단(_layout)에서 마운트 시 1회 호출. */
export function initAppUpdateChecker(): () => void {
  checkAndApplyUpdate()
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') checkAndApplyUpdate()
  })
  return () => sub.remove()
}
