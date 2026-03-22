export const DarkColors = {
  background: '#0F0F0F',
  surface: '#1A1A1A',
  surfaceHigh: '#242424',
  primary: '#FF6B9D',
  primaryDark: '#E05585',
  secondary: '#9B59F5',
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#606060',
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  deadline: '#FF4444',
  border: '#2A2A2A',
  divider: '#1E1E1E',
  tagBackground: '#2A2A2A',
  tagText: '#C0C0C0',
  text: '#FFFFFF',
} as const

export const LightColors = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceHigh: '#EFEFEF',
  primary: '#FF6B9D',
  primaryDark: '#E05585',
  secondary: '#9B59F5',
  textPrimary: '#111111',
  textSecondary: '#555555',
  textTertiary: '#999999',
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  deadline: '#FF4444',
  border: '#E0E0E0',
  divider: '#EEEEEE',
  tagBackground: '#EEEEEE',
  tagText: '#444444',
  text: '#111111',
} as const

export type AppColors = typeof DarkColors | typeof LightColors

// 하위 호환용 기본값 (다크)
export const Colors = DarkColors
