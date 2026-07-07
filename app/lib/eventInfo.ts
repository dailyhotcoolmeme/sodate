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

  // 연령: 숫자로 끝나면 "세" 부착(27~34→27~34세), 아니면 그대로("나이 무관", "35~45세")
  if (opts.age) parts.push(/\d\s*$/.test(opts.age) ? `${opts.age}세` : opts.age)

  return parts.join(' · ')
}
