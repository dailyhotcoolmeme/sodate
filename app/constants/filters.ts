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

/**
 * 시간대 id 목록 -> 해당하는 KST 시(0~23) 목록.
 *
 * 2026-08-19: 예전엔 한 페이지(60건)를 받아 timeSlotOf 로 클라이언트에서 걸렀는데,
 * 목록이 날짜순이라 첫 페이지가 대략 하루치뿐이어서 걸러낸 결과가 몇 건 안 나왔고
 * 앱이 다음 페이지를 계속 이어 받았다(실측: 평일 필터 시 요청 19회·937KB·1.14초로
 * 22건). 이제 events.event_hour 생성 컬럼을 서버에서 직접 거른다 —
 * supabase/migrations/20260819_events_kst_dow_hour.sql 참고.
 *
 * ⚠️ 여기 경계값은 위 timeSlotOf 와 반드시 같아야 한다. 한쪽만 고치면 필터 결과가
 *    화면 표시와 어긋난다.
 */
export function hoursForTimeSlots(slots: string[]): number[] {
  const hours = new Set<number>()
  for (let h = 0; h < 24; h++) {
    if (slots.includes(timeSlotOf(h))) hours.add(h)
  }
  return [...hours]
}
