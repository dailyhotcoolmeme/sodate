export interface AgeGroupFilter {
  id: string
  label: string
  label2?: string
  min?: number
  max?: number
}

export const AGE_GROUP_FILTERS: AgeGroupFilter[] = [
  { id: 'all', label: '전체' },
  { id: '20s_early', label: '20대 초반', min: 23, max: 27 },
  { id: '20s_late', label: '20대 후반', min: 27, max: 32 },
  { id: '30s_early', label: '30대 초반', min: 32, max: 37 },
  { id: '30s_late', label: '30대 중후반', min: 37, max: 43 },
  { id: '2030', label: '2030', label2: '20~30대', min: 20, max: 40 },
  { id: '3040', label: '3040', label2: '30~40대', min: 30, max: 50 },
]
