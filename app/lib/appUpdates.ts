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

// 켜둔 채로 계속 쓰면 포그라운드 전환이 안 일어나 확인 기회가 없다 — 2026-08-17에
// 실제로 그래서 옛 번들 그대로 쓰다가 "고친 게 왜 안 보이냐"가 됐다. 앱이 떠 있는
// 동안에는 주기적으로도 확인한다.
const PERIODIC_CHECK_MS = 15 * 60 * 1000

/** 앱 최상단(_layout)에서 마운트 시 1회 호출. */
export function initAppUpdateChecker(): () => void {
  checkAndApplyUpdate()
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') checkAndApplyUpdate()
  })
  const timer = setInterval(() => {
    // 백그라운드에서는 굳이 돌리지 않는다(어차피 돌아올 때 위 리스너가 확인한다).
    if (AppState.currentState === 'active') checkAndApplyUpdate()
  }, PERIODIC_CHECK_MS)
  return () => {
    sub.remove()
    clearInterval(timer)
  }
}
