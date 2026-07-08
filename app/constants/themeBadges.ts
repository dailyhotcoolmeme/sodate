// 업체 테마 배지 메타 — 토크블라썸의 결혼희망/STAR/MVP 등 특수 테마를
// 피드·목록엔 배지로, 상세엔 배지+한줄설명으로 노출한다.
// events.theme(text[]) 값과 매칭. 일반 테마(와인 등)는 여기 없으면 배지 미표시.
export type ThemeBadgeMeta = {
  label: string
  note: string   // 상세페이지 한줄 설명
  color: string  // 텍스트 색
  bg: string     // 배지 배경(반투명 — 라이트/다크 공용)
}

export const THEME_BADGES: Record<string, ThemeBadgeMeta> = {
  결혼희망: {
    label: '결혼희망',
    note: '결혼 지향·고스펙 인증 모임',
    color: '#D6336C',
    bg: 'rgba(214,51,108,0.12)',
  },
  STAR: {
    label: 'STAR',
    note: '인기·비주얼 인증 모임',
    color: '#7048E8',
    bg: 'rgba(112,72,232,0.12)',
  },
  MVP: {
    label: 'MVP',
    note: '최상위(재력·전문직·다득표 인증) 모임',
    color: '#0CA678',
    bg: 'rgba(12,166,120,0.14)',
  },
}

// 이벤트 theme 배열에서 첫 매칭 배지 메타 반환(없으면 null)
export function getThemeBadge(themes?: string[] | null): ThemeBadgeMeta | null {
  if (!themes) return null
  for (const t of themes) {
    const meta = THEME_BADGES[t]
    if (meta) return meta
  }
  return null
}
