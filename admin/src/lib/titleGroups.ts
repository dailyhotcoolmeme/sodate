// "같은 호스트가 올린 같은 모임"을 한 세트로 묶는다.
//
// 왜 필요한가(2026-07-30 오너): 문토·프립은 한 호스트가 같은 모임을 지역·나이·날짜만
// 바꿔 계속 올린다. 그래서 목록에는 제목이 전부 달라 보이지만 실제로는 몇 개 안 되는
// 모임이다. 이걸 세트로 묶어야 상세 설명 이미지와 해시태그를 한 번에 같은 걸로 맞춘다.
//
// 묶는 방법
//   1) 같은 상품이면 무조건 한 세트 — 프립은 URL의 상품 id가 같으면 일정만 다른 같은 모임.
//   2) 나머지는 제목에서 '매번 바뀌는 부분'(나이·날짜·요일·회차·가격·이모지)을 지우고,
//      남은 고유 부분끼리 비슷하면 합친다.
//   3) 비교할 때 '로테이션 소개팅'처럼 어느 모임에나 있는 말은 뺀다. 안 그러면
//      전혀 다른 모임이 그 말만으로 묶여버린다.

export interface TitleRow {
  title: string
  url: string
}

export interface TitleGroup {
  /** 이 세트를 대표하는 제목(가장 많이 쓰인 것) */
  rep: string
  /** 세트에 속한 모임들 */
  rows: TitleRow[]
  /** 검색어로 쓰기 좋은 공통 문구. 없으면 빈 문자열 */
  keyword: string
}

// 어느 모임에나 붙어 비교에 방해되는 말
const GENERIC = [
  '로테이션소개팅', '로테이션', '소개팅', '모임', '파티', '만남',
  '신규오픈', '오픈', '특집', '현재', '모집', '마감', '임박',
]

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}\u{00A9}\u{00AE}]/gu

/** 제목에서 건마다 바뀌는 정보(날짜·나이·회차·가격)를 걷어낸다. */
function normalize(title: string): string {
  let s = title.replace(/^\[[^\]]*\]\s*/, '') // [프립] [문토] 머리표
  s = s.replace(EMOJI, ' ')
  s = s.replace(/\[[^\]]*\]/g, ' ') // [373회], [강남] 등
  s = s.replace(/\(\s*[월화수목금토일][^)]*\)/g, ' ') // (토) (토요일 ...)
  s = s.replace(/\d{1,2}\s*[/.]\s*\d{1,2}/g, ' ') // 8/1, 8.15
  s = s.replace(/\d{1,2}\s*시(\s*\d{1,2}\s*분)?/g, ' ')
  s = s.replace(/\d{2}\s*[-~]\s*\d{2}/g, ' ') // 32-40, 92~97
  s = s.replace(/\d{1,2}\s*0?대(만)?/g, ' ') // 30대, 30대만
  s = s.replace(/\d[\d,.]*\s*(원|만)/g, ' ') // 1.9만, 20000원
  s = s.replace(/[월화수목금토일]요일/g, ' ')
  s = s.replace(/\d+/g, ' ')
  s = s.replace(/[^\w가-힣]+/g, ' ')
  return s.trim().split(/\s+/).join(' ')
}

/** 비교용 — 흔한 말을 뺀 '이 모임만의 부분'. */
function coreOf(title: string): string {
  let s = normalize(title).replace(/\s+/g, '')
  for (const g of GENERIC) s = s.split(g).join('')
  return s
}

function shingles(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 2 <= s.length; i++) out.add(s.slice(i, i + 2))
  if (!out.size && s) out.add(s)
  return out
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 두 문자열의 가장 긴 공통 부분 문자열 */
function longestCommon(a: string, b: string): string {
  if (!a || !b) return ''
  let best = ''
  // 제목 길이가 짧아(수십 자) 이 정도 비용은 문제되지 않는다.
  for (let i = 0; i < a.length; i++) {
    for (let j = a.length; j > i + best.length; j--) {
      const sub = a.slice(i, j)
      if (b.includes(sub)) {
        if (sub.length > best.length) best = sub
        break
      }
    }
  }
  return best
}

/** 세트 전체 제목에 공통으로 들어있는 가장 긴 문구 = 그대로 검색어로 쓸 수 있다. */
function commonKeyword(titles: string[]): string {
  const uniq = [...new Set(titles.map((t) => t.replace(/^\[[^\]]*\]\s*/, '').trim()))]
  if (!uniq.length) return ''
  if (uniq.length === 1) return uniq[0]
  let common = uniq[0]
  for (let i = 1; i < uniq.length && common; i++) common = longestCommon(common, uniq[i])
  common = common.replace(EMOJI, ' ').trim()
  common = trimFragment(common)
  return common.length >= 2 ? common : ''
}

/**
 * 공통 문구 끝에 남는 잘린 조각을 떼어낸다.
 * 예: '2차무료+매칭 [강' → '2차무료+매칭'
 * (제목이 [강남]/[강서]로 갈리는데 공통 부분이 '[강'까지라 그대로 두면
 *  검색어로 못 쓴다.)
 */
function trimFragment(s: string): string {
  let out = s
  // 짝이 안 맞는 여는 괄호부터 끝까지 자른다
  for (const [open, close] of [['[', ']'], ['(', ')'], ['{', '}']]) {
    const i = out.lastIndexOf(open)
    if (i !== -1 && out.indexOf(close, i) === -1) out = out.slice(0, i)
  }
  // 양끝의 기호·공백 정리
  return out.replace(/^[^\w가-힣]+/, '').replace(/[^\w가-힣]+$/, '').trim()
}

// 고유 부분이 이보다 짧으면 합치지 않는다 — 남은 글자가 몇 자 안 되면
// 우연히 비슷해 보여 엉뚱한 모임이 붙는다.
const MIN_CORE = 4
const MERGE_THRESHOLD = 0.5

/** 모임들을 '같은 호스트의 같은 모임' 세트로 묶어 건수 많은 순으로 돌려준다. */
export function suggestGroups(rows: TitleRow[]): TitleGroup[] {
  // 1) 같은 상품(URL의 # 앞)은 무조건 한 덩어리
  const byProduct = new Map<string, TitleRow[]>()
  for (const r of rows) {
    const key = (r.url || r.title).split('#')[0]
    const list = byProduct.get(key)
    if (list) list.push(r)
    else byProduct.set(key, [r])
  }

  interface Unit {
    rows: TitleRow[]
    rep: string
    core: string
    sh: Set<string>
  }
  const units: Unit[] = []
  for (const list of byProduct.values()) {
    const count = new Map<string, number>()
    for (const r of list) count.set(r.title, (count.get(r.title) ?? 0) + 1)
    const rep = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const core = coreOf(rep)
    units.push({ rows: list, rep, core, sh: shingles(core) })
  }
  units.sort((a, b) => b.rows.length - a.rows.length)

  // 2) 고유 부분이 비슷하면 합친다. 비교는 항상 '세트 대표'와만 한다 —
  //    세트가 커질수록 아무거나 끌어당기는 것을 막기 위해서.
  const clusters: Unit[] = []
  for (const u of units) {
    let best: Unit | null = null
    let bestScore = 0
    if (u.core.length >= MIN_CORE) {
      for (const c of clusters) {
        if (c.core.length < MIN_CORE) continue
        const s = similarity(u.sh, c.sh)
        if (s > bestScore) {
          bestScore = s
          best = c
        }
      }
    }
    if (best && bestScore >= MERGE_THRESHOLD) best.rows.push(...u.rows)
    else clusters.push({ ...u, rows: [...u.rows] })
  }

  return clusters
    .sort((a, b) => b.rows.length - a.rows.length)
    .map((c) => ({
      rep: c.rep,
      rows: c.rows,
      keyword: commonKeyword(c.rows.map((r) => r.title)),
    }))
}

/** 어느 세트에도 안 들어간 모임(항상 비어 있지만, 화면 문구용으로 유지) */
export function ungrouped(rows: TitleRow[], groups: TitleGroup[]): TitleRow[] {
  const inGroup = new Set(groups.flatMap((g) => g.rows.map((r) => r.url || r.title)))
  return rows.filter((r) => !inGroup.has(r.url || r.title))
}
