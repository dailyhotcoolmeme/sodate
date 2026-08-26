import { create } from 'zustand'
import { Appearance } from 'react-native'
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
    // ⚠️(2026-08-26 오너 지시) 예전엔 저장값이 없으면 무조건 화이트모드였다 — 기기를
    // 다크모드로 쓰는 사람이 앱을 처음 켜면 혼자만 밝게 떠서 이질적이었다. 저장된
    // 사용자 선택이 있으면 그걸 그대로 따르고(설정에서 직접 토글한 사람의 의사가 우선),
    // 아직 한 번도 안 바꾼 첫 실행에서만 기기 시스템 설정을 따라간다.
    const isDark = saved === 'dark' ? true
      : saved === 'light' ? false
      : Appearance.getColorScheme() === 'dark'
    set({ isDark, colors: isDark ? DarkColors : LightColors })
  },
}))
