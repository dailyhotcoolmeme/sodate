// 한국(Asia/Seoul) 달력 날짜 기준 D-day 계산.
// 기기/런타임 타임존과 무관하게 항상 KST '날짜'로만 비교한다. (시각 무시)
// 오늘 = 0, 내일 = 1, 어제 = -1.
//
// 과거 버그: Math.ceil((event - now)/하루) 처럼 '시각'을 섞어 계산해서
// 오늘 저녁 행사가 D-1로 잘못 표기됐다. 또한 기기가 UTC 타임존이면
// 로컬 자정 기준 계산도 하루 밀렸다. 둘 다 KST 날짜 비교로 해결.

// 어떤 시각(Date)을 KST 벽시계 날짜의 epoch-day(정수)로 변환
function kstEpochDay(d: Date): number {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000) // UTC+9
  return Math.floor(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) / 86400000,
  )
}

export function daysUntil(dateStr: string): number {
  const ev = new Date(dateStr)
  if (isNaN(ev.getTime())) return 0
  return kstEpochDay(ev) - kstEpochDay(new Date())
}
