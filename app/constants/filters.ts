export const DAY_OPTIONS: { id: number; label: string }[] = [
  { id: 1, label: '월' },
  { id: 2, label: '화' },
  { id: 3, label: '수' },
  { id: 4, label: '목' },
  { id: 5, label: '금' },
  { id: 6, label: '토' },
  { id: 0, label: '일' },
]

export const TIME_SLOTS: { id: string; label: string }[] = [
  { id: 'morning', label: '오전' }, // ~12시
  { id: 'afternoon', label: '오후' }, // 12~17
  { id: 'evening', label: '저녁' }, // 17~21
  { id: 'night', label: '밤' }, // 21시~
]

// 이벤트 시각의 KST 요일(0=일~6=토) / 시간대 id
export function kstDowHour(dateStr: string): { dow: number; hour: number } {
  const kst = new Date(new Date(dateStr).getTime() + 9 * 3600000)
  return { dow: kst.getUTCDay(), hour: kst.getUTCHours() }
}

export function timeSlotOf(hour: number): string {
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}
