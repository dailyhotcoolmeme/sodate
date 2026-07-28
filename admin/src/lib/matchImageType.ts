// 상세 설명 이미지 유형의 "검색어 매칭" 규칙.
//
// ⚠️ 앱(app/hooks/useEventDetail.ts 의 resolveDescImages)과 같은 규칙이어야 한다.
//    admin 화면에 "이 모임엔 이 이미지가 나갑니다"라고 보여주는데 실제와 다르면
//    오너가 잘못 판단하게 된다.
//
// 규칙
//   · 유형마다 검색어(match_keywords)를 여러 개 둘 수 있다. 모임 제목에 그중 하나라도
//     들어있으면 그 유형.
//   · 검색어가 하나도 없으면 유형 이름으로 매칭한다(예전 방식, 하위호환).
//   · 여러 유형이 걸리면 걸린 검색어가 가장 긴 쪽(= 더 구체적인 쪽)이 이긴다.
//   · 아무것도 안 걸리면 null → 앱에서 상세 설명 섹션이 통째로 안 나온다.

export interface MatchableType {
  name: string
  match_keywords?: string[] | null
}

/** 이 유형이 쓰는 검색어들(비어 있으면 이름을 검색어로). */
export function keywordsOf(t: MatchableType): string[] {
  const ks = (t.match_keywords ?? []).map((k) => String(k).trim()).filter(Boolean)
  if (ks.length) return ks
  const n = String(t.name ?? '').trim()
  return n ? [n] : []
}

/** 제목이 이 유형에 걸리면, 걸린 검색어 중 가장 긴 것을 돌려준다. 안 걸리면 null. */
export function matchedKeyword(title: string | null | undefined, t: MatchableType): string | null {
  const hay = (title ?? '').toLowerCase()
  if (!hay) return null
  const hits = keywordsOf(t).filter((k) => hay.includes(k.toLowerCase()))
  if (!hits.length) return null
  return hits.sort((a, b) => b.length - a.length)[0]
}

export function matchTypeByName<T extends MatchableType>(
  title: string | null | undefined,
  types: T[] | undefined,
): T | null {
  if (!types?.length) return null
  let best: { t: T; len: number } | null = null
  for (const t of types) {
    const k = matchedKeyword(title, t)
    if (!k) continue
    if (!best || k.length > best.len) best = { t, len: k.length }
  }
  return best?.t ?? null
}
