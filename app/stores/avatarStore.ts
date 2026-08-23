import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

/** 선택한 프리셋 아바타 id(기기 저장). 없으면 기본 사람 아이콘. 닉네임처럼 전 서비스 공용. */
interface AvatarState {
  avatarId: string | null
  setAvatarId: (id: string | null) => void
}

export const useAvatarStore = create<AvatarState>()(
  persist(
    (set) => ({
      avatarId: null,
      setAvatarId: (avatarId) => set({ avatarId }),
    }),
    { name: 'sodate-avatar', storage: createJSONStorage(() => AsyncStorage) },
  ),
)
