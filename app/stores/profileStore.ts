import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface ProfileState {
  myAge: number | null          // 사용자 현재 나이 (숫자 직접 입력, 예: 28)
  myGender: 'male' | 'female' | null
  setMyAge: (age: number | null) => void
  setMyGender: (gender: 'male' | 'female' | null) => void
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      myAge: null,
      myGender: null,
      setMyAge: (myAge) => set({ myAge }),
      setMyGender: (myGender) => set({ myGender }),
    }),
    {
      name: 'sodate-profile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
