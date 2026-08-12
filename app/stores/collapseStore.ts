import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

// 필터/알림설정 화면의 섹션별 접기·펼치기 상태 — 기기에 저장해 다음 진입 때도
// 사용자가 마지막에 둔 상태 그대로 유지한다(오너 지시 2026-08-12). 키에 없으면
// 기본값은 접힘(false) — 처음 진입 시 전부 한 줄씩 접힌 상태로 보이게.
interface CollapseState {
  expanded: Record<string, boolean>
  toggle: (key: string) => void
  setMany: (keys: string[], value: boolean) => void
}

export const useCollapseStore = create<CollapseState>()(
  persist(
    (set) => ({
      expanded: {},
      toggle: (key) =>
        set((s) => ({ expanded: { ...s.expanded, [key]: !(s.expanded[key] ?? false) } })),
      setMany: (keys, value) =>
        set((s) => ({
          expanded: { ...s.expanded, ...Object.fromEntries(keys.map((k) => [k, value])) },
        })),
    }),
    {
      name: 'sodate-collapse',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
