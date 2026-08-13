import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DarkColors, LightColors, AppColors } from '@/constants/colors'

const THEME_KEY = 'sodate-theme'

interface ThemeStore {
  isDark: boolean
  colors: AppColors
  toggle: () => void
  load: () => Promise<void>
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  isDark: false,
  colors: LightColors,
  toggle: () => {
    const next = !get().isDark
    set({ isDark: next, colors: next ? DarkColors : LightColors })
    AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
  },
  load: async () => {
    const saved = await AsyncStorage.getItem(THEME_KEY)
    // 기본값 = 화이트모드. 저장된 값이 명시적으로 'dark'일 때만 다크모드.
    const isDark = saved === 'dark'
    set({ isDark, colors: isDark ? DarkColors : LightColors })
  },
}))
