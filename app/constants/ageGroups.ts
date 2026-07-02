export interface AgeGroupFilter {
  id: string
  label: string
  min: number
  max: number
}

// 5살 단위 구간 (다중 선택). 아무것도 안 고르면 = 전체.
export const AGE_GROUP_FILTERS: AgeGroupFilter[] = [
  { id: '20_25', label: '20~25세', min: 20, max: 25 },
  { id: '25_30', label: '25~30세', min: 25, max: 30 },
  { id: '30_35', label: '30~35세', min: 30, max: 35 },
  { id: '35_40', label: '35~40세', min: 35, max: 40 },
  { id: '40_45', label: '40~45세', min: 40, max: 45 },
]
