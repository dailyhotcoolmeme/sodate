// 상세 이미지 유형이 아직 없는 모임들을 "비슷한 것끼리" 묶어 보여주기 위한 후보 뽑기.
//
// 왜 필요한가: 문토·프립은 주최자가 제목을 자유롭게 쓴다. 제목이 전부 달라서 목록을
// 아무리 봐도 공통점이 안 보이고, 어디부터 손대야 할지 알 수 없다(2026-07-30 오너).
// 나머지 업체는 제목 형식이 일정해 눈으로 묶였지만 이 둘은 안 된다.
//
// 왜 '구절'인가: 유형 매칭이 곧 검색어(match_keywords) 포함 여부다(matchImageType.ts).
// 그러니 제목에서 자주 나오는 구절을 뽑아 "이 검색어를 쓰면 N건이 걸린다"로 보여주면,
// 오너가 그 구절을 그대로 검색어에 넣으면 끝난다. 추상적인 군집보다 바로 쓸 수 있다.

export interface TitleRow {
  title: string
  url: string
}

export interface TitleGroup {
  /** 검색어로 그대로 쓸 수 있는 구절 */
  phrase: string
  /** 이 구절이 제목에 들어있는 모임들 */
  rows: TitleRow[]
}

// 어느 모임에나 있어서 묶는 데 도움이 안 되는 말들.
const STOP = new Set([
  '소개팅', '로테이션', '모임', '파티', '만남', '참여', '신청', '모집', '진행',
  '이상', '이하', '전용', '사람', '여자', '남자', '남녀', '이성', '친구',
  '오늘', '내일', '주말', '평일', '마감', '임박', '자리', '인원',
  // 판촉·조건 문구 — 유형이 아니라 그때그때 붙는 말이라 묶어도 쓸모가 없다
  // (문토에서 '선착순' 12건, '할인' 5건, '년생' 5건처럼 올라왔다).
  '선착순', '할인', '특가', '초특가', '한정', '이벤트', '오픈', '예약', '잔여',
  '년생', '추가', '무제한',
])

/** 제목에서 날짜·가격·[대괄호] 같은 건별 정보를 걷어내고 단어만 남긴다. */
function tokenize(title: string): string[] {
  let s = title.replace(/\[[^\]]*\]/g, ' ') // [프립], [서울 강남] 같은 머리표
  s = s.replace(/\d[\d,:./~\-]*/g, ' ') // 날짜·시간·가격·8:8
  s = s.replace(/[^\w가-힣\s]/g, ' ') // 이모지·기호
  return s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP.has(w))
}

/**
 * 모임 제목들에서 묶음 후보를 뽑아 '걸리는 모임 수' 많은 순으로 돌려준다.
 *
 * 겹치는 후보는 접는다 — '연령별'(51건)과 '연령별 와인파티'(51건)처럼 같은 모임을
 * 가리키면 더 구체적인 쪽만 남긴다. 그래서 목록에 같은 덩어리가 두 번 안 나온다.
 */
export function suggestGroups(rows: TitleRow[], minCount = 2): TitleGroup[] {
  // 구절 → 그 구절이 들어간 모임들
  const byPhrase = new Map<string, TitleRow[]>()
  for (const row of rows) {
    const toks = tokenize(row.title)
    const seen = new Set<string>()
    for (const n of [2, 1]) {
      for (let i = 0; i + n <= toks.length; i++) {
        const phrase = toks.slice(i, i + n).join(' ')
        if (seen.has(phrase)) continue
        seen.add(phrase)
        const list = byPhrase.get(phrase)
        if (list) list.push(row)
        else byPhrase.set(phrase, [row])
      }
    }
  }

  const all = [...byPhrase.entries()]
    .filter(([, list]) => list.length >= minCount)
    // 건수 많은 순 → 같으면 더 구체적인(긴) 구절 먼저
    .sort((a, b) => b[1].length - a[1].length || b[0].length - a[0].length)

  const picked: TitleGroup[] = []
  for (const [phrase, list] of all) {
    const urls = new Set(list.map((r) => r.url || r.title))
    // 이미 뽑은 묶음에 완전히 포함되면 새 정보가 없다 → 버린다
    const covered = picked.some((g) => {
      const gu = new Set(g.rows.map((r) => r.url || r.title))
      for (const u of urls) if (!gu.has(u)) return false
      return true
    })
    if (covered) continue
    picked.push({ phrase, rows: list })
  }
  return picked
}

/** 남은(어느 묶음에도 안 들어간) 모임들 */
export function ungrouped(rows: TitleRow[], groups: TitleGroup[]): TitleRow[] {
  const inGroup = new Set(groups.flatMap((g) => g.rows.map((r) => r.url || r.title)))
  return rows.filter((r) => !inGroup.has(r.url || r.title))
}
