/**
 * 소셜링 통합 카테고리(2026-08-21, 오너 승인).
 *
 * 소스마다 원본 카테고리 체계가 달라서(문토 9종·동행클럽 6종·트레바리 1종) 그대로 칩을
 * 만들면 20개+로 난잡하다. 상위 10종으로 묶어 하나의 체계로 보여준다.
 *   - 배지: 피드 행의 제목 위 색 배지로 카테고리를 한눈에.
 *   - 필터: 상단 칩. 한 그룹을 고르면 그 그룹의 원본 카테고리 여러 개를 .in() 으로 조회.
 * 원본 socialing_category 는 DB에 그대로 보존 → 언제든 재분류 가능.
 */
export interface SocialingGroup {
  key: string
  label: string
  emoji: string
  /** 이 그룹으로 묶이는 원본 socialing_category 값들(크롤러가 저장한 그대로) */
  sources: string[]
}

export const SOCIALING_GROUPS: SocialingGroup[] = [
  { key: 'reading',   label: '독서·글쓰기',   emoji: '📖', sources: ['독서·성장', '글쓰기', '사유의 확장', '자아와 관계'] },
  { key: 'culture',   label: '문화·예술',     emoji: '🎨', sources: ['문화·예술', '음악과 OST'] },
  { key: 'movie',     label: '영화',          emoji: '🍿', sources: ['영화', '영화와 넷플릭스'] },
  { key: 'active',    label: '운동·아웃도어', emoji: '⛰️', sources: ['등산·아웃도어'] },
  { key: 'cooking',   label: '쿠킹·다이닝',   emoji: '🍳', sources: ['쿠킹·다이닝'] },
  { key: 'travel',    label: '여행',          emoji: '🏕️', sources: ['여행·캠핑'] },
  { key: 'career',    label: '커리어·재테크', emoji: '💼', sources: ['재테크·경제', '일과 커리어'] },
  { key: 'language',  label: '외국어',        emoji: '🗣️', sources: ['외국어'] },
  { key: 'game',      label: '게임',          emoji: '🎲', sources: ['게임'] },
  { key: 'lifestyle', label: '라이프스타일',  emoji: '🌱', sources: ['라이프스타일'] },
]

// 원본 카테고리 → 그룹 역인덱스(빠른 조회)
const SOURCE_TO_GROUP: Record<string, SocialingGroup> = {}
for (const g of SOCIALING_GROUPS) {
  for (const s of g.sources) SOURCE_TO_GROUP[s] = g
}

/** 원본 socialing_category → 통합 그룹. 매핑 없거나 null 이면 undefined(배지 생략). */
export function groupForCategory(category?: string | null): SocialingGroup | undefined {
  if (!category) return undefined
  return SOURCE_TO_GROUP[category]
}

/** 그룹 key → 그 그룹의 원본 카테고리 배열(필터 .in() 용). 없으면 빈 배열. */
export function sourcesForGroupKey(key: string): string[] {
  return SOCIALING_GROUPS.find((g) => g.key === key)?.sources ?? []
}
