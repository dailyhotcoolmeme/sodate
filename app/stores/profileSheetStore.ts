import { create } from 'zustand'

// 내 정보(나이·성별) 바텀시트를 어느 화면에서든 그 자리에서 열기 위한 전역 플래그.
// (기존엔 홈에만 모달이 있어 하위 페이지에선 홈으로 이동해야 했음 → 전역화)
interface ProfileSheetState {
  open: boolean
  openSheet: () => void
  closeSheet: () => void
}

export const useProfileSheetStore = create<ProfileSheetState>((set) => ({
  open: false,
  openSheet: () => set({ open: true }),
  closeSheet: () => set({ open: false }),
}))
