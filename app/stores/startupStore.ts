import { create } from 'zustand'

/**
 * 앱을 켜자마자 커뮤니티로 보낼지 여부(2026-09-01).
 *
 * 파일 기반 라우팅이라 시작 경로가 '/'(소개팅 피드)로 고정돼 있고, _layout 이 그 뒤에
 * '/board' 로 바꿔 끼운다. 그런데 그 사이에 소개팅 피드가 **통째로 마운트되면서 일정 60건을
 * 조회하고 광고까지 미리 불러온 뒤 곧바로 버려졌다** — 쓰지도 않을 화면을 다 그리고
 * 지우느라 시작이 느렸다(2026-09-01 오너 "앱 여는 게 왜 이렇게 느리냐" 제보로 발견).
 *
 * 그래서 시작 직후에는 소개팅 피드가 스스로 "나는 지금 안 그려도 된다"를 알 수 있게 한다.
 * _layout 이 갈 곳을 정하고 나면 done() 을 불러 잠금을 푼다.
 */
interface StartupState {
  /** true = 시작 직후라 곧 다른 화면으로 넘어간다. 무거운 조회를 미룬다. */
  redirecting: boolean
  done: () => void
}

export const useStartupStore = create<StartupState>((set) => ({
  redirecting: true,
  done: () => set({ redirecting: false }),
}))
