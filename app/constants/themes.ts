export const THEMES = [
  { id: '와인', label: '🍷 와인' },
  { id: '커피', label: '☕ 커피' },
  { id: '에세이', label: '📖 에세이' },
  { id: '전시', label: '🎨 전시' },
  { id: '사주', label: '🔮 사주' },
  { id: '보드게임', label: '🎲 보드게임' },
  { id: '쿠킹', label: '👨‍🍳 쿠킹' },
  { id: '일반', label: '💬 일반' },
] as const

export type ThemeId = typeof THEMES[number]['id']
