import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface AlertState {
  subscribedCompanyIds: string[]
  pushEnabled: boolean
  subscribe: (companyId: string) => void
  unsubscribe: (companyId: string) => void
  isSubscribed: (companyId: string) => boolean
  setPushEnabled: (enabled: boolean) => void
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set, get) => ({
      subscribedCompanyIds: [],
      pushEnabled: false,

      subscribe: (companyId) =>
        set((state) => ({
          subscribedCompanyIds: [...state.subscribedCompanyIds, companyId],
        })),

      unsubscribe: (companyId) =>
        set((state) => ({
          subscribedCompanyIds: state.subscribedCompanyIds.filter(
            (id) => id !== companyId
          ),
        })),

      isSubscribed: (companyId) =>
        get().subscribedCompanyIds.includes(companyId),

      setPushEnabled: (enabled) => set({ pushEnabled: enabled }),
    }),
    {
      name: 'sodate-alerts',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
