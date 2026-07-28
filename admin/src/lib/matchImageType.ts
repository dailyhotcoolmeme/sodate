// 상세 설명 이미지 유형의 "이름 매칭" 규칙.
//
// ⚠️ 앱(app/hooks/useEventDetail.ts 의 resolveDescImages)과 같은 규칙이어야 한다.
//    admin 화면에 "이 모임엔 이 이미지가 나갑니다"라고 보여주는데 실제와 다르면
//    오너가 잘못 판단하게 된다.
//
// 규칙: 모임명에 유형 이름이 포함되면 그 유형. 여러 개 걸리면 이름이 긴 쪽(더 구체적).
// 아무것도 안 걸리면 null → 앱에서 상세 설명 섹션이 통째로 안 나온다.

export function matchTypeByName<T extends { name: string }>(
  title: string | null | undefined,
  types: T[] | undefined,
): T | null {
  const t = (title ?? '').toLowerCase()
  if (!t || !types?.length) return null
  const hit = types
    .filter((x) => {
      const n = String(x?.name ?? '').trim().toLowerCase()
      return n.length > 0 && t.includes(n)
    })
    .sort((a, b) => String(b.name).trim().length - String(a.name).trim().length)
  return hit[0] ?? null
}
