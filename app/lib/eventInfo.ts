// 성별 한 줄 요약: "50,000원 · 29~34세" 형태로 합친다.
// 값이 없는 항목은 자동으로 빠지고, 가운데점(·)으로 연결.
export function genderInfoLine(opts: {
  capacity: number | null
  seats: number | null
  price: number | null
  age: string | null
}): string {
  const parts: string[] = []

  // 인원(정원/잔여석)은 실시간 갱신 전까지 숨김 — 나중에 재검토 시 아래 블록 복원.
  // if (opts.capacity != null && opts.seats != null) {
  //   parts.push(opts.seats === 0 ? '마감' : `${opts.seats}/${opts.capacity}명`)
  // } else if (opts.capacity != null) {
  //   parts.push(`${opts.capacity}명`)
  // } else if (opts.seats != null) {
  //   parts.push(opts.seats === 0 ? '마감' : `${opts.seats}석`)
  // }

  // 참가비
  if (opts.price != null) parts.push(`${opts.price.toLocaleString()}원`)

  // 연령 (오너가 "세"를 이미 붙였으면 그대로)
  if (opts.age) parts.push(/세\s*$/.test(opts.age) ? opts.age : `${opts.age}세`)

  return parts.join(' · ')
}
