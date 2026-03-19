export const REGIONS = [
  { id: 'all', label: '전체' },
  { id: '강남', label: '강남' },
  { id: '역삼', label: '역삼' },
  { id: '홍대', label: '홍대' },
  { id: '신촌', label: '신촌' },
  { id: '을지로', label: '을지로' },
  { id: '이태원', label: '이태원' },
  { id: '성수', label: '성수' },
  { id: '잠실', label: '잠실' },
  { id: '수원', label: '수원' },
  { id: '인천', label: '인천' },
  { id: '대전', label: '대전' },
] as const

export type RegionId = typeof REGIONS[number]['id']
