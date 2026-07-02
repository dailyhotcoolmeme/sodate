// 해시태그 시작 사전 (spec: docs/hashtag_and_crawler_fixes_spec.md)
// admin에서 계속 편집 가능. 앱 필터 UI의 기본 후보 목록.

// 컨셉
export const HASHTAG_CONCEPT = [
  '#와인',
  '#요리',
  '#보드게임',
  '#등산·아웃도어',
  '#전시·문화',
  '#가치관팅',
  '#사주·타로',
  '#독서',
]

// 형식
export const HASHTAG_FORMAT = [
  '#1:1',
  '#소규모',
  '#로테이션',
  '#커피미팅',
  '#식사모임',
  '#사회자진행',
]

// 대상
export const HASHTAG_TARGET = [
  '#직장인',
  '#전문직',
  '#20대',
  '#30대',
  '#40대',
]

// 전체 시작 사전 (중복 없이 순서 유지)
export const HASHTAG_SEED: string[] = [
  ...HASHTAG_CONCEPT,
  ...HASHTAG_FORMAT,
  ...HASHTAG_TARGET,
]
