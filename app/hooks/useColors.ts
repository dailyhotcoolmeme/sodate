import { useThemeStore } from '@/stores/themeStore'
import type { AppColors } from '@/constants/colors'

export function useColors(): AppColors {
  return useThemeStore((s) => s.colors)
}
