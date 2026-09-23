/** 게시판 공통 날짜: 연도 2자리-월-일(요일) 시:분:초. */
export function formatBoardDateTime(iso: string): string {
  const d = new Date(iso)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const p = (n: number) => String(n).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${yy}-${p(d.getMonth() + 1)}-${p(d.getDate())}(${days[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
