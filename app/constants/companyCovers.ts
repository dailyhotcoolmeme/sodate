// 이미지 없는 업체용 "고정 배경 이미지" — 업체별 테마에 맞는 스톡 사진(Unsplash).
// 이벤트 썸네일이 없거나 로고/플레이스홀더/로딩실패면 이 배경 위에 텍스트를 오버레이한다.
// 새 업체는 여기 한 줄만 추가하면 됨(없으면 DEFAULT 사용).

const P = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=800&q=80&fit=crop&crop=entropy&auto=format`

// 사람 없는 이미지만 사용 (서양인 사진이 한국 소개팅과 안 맞아 전부 사물·인테리어로)
export const COMPANY_COVERS: Record<string, string> = {
  '연인어때': P('1593536488177-1eb3c2d4e3d2'),      // 에디슨 전구 무드
  '토크블라썸': P('1645928908851-84c19934eeaf'),    // 와인잔
  '모드파티': P('1620142051956-9516abaee760'),      // 레드와인 + 조명 보케
  '러브캐스팅': P('1634465474088-e82e29b64ecc'),    // 라떼 두 잔
  '괜찮소': P('1513244608388-32427255be63'),        // 라떼아트
  '시크릿살롱': P('1775215237032-54e9f5a67e40'),    // 무드있는 레드와인
  '인썸파티': P('1570657854607-67ed08894c4b'),      // 와인잔 + 캔들
  '프립': P('1637153468029-bd762b3a0b33'),          // 감성 카페 코너
  '문토': P('1682331936363-48d9aaf75278'),          // 아늑한 카페
  '에모셔널오렌지': P('1477761614229-3daf5798eedd'), // 따뜻한 커피
  '러브커뮤니티': P('1526396243362-aa62496aca59'),  // 티포트
}

export const DEFAULT_COVER = P('1545731939-9c302d5d27ed') // 깔끔한 라떼

// 썸네일이 항상 로고라서 실제 사진이 없는 업체 — 이벤트 썸네일 무시하고 무조건 커버 사용
export const ALWAYS_COVER = new Set<string>(['연인어때', '토크블라썸'])

export function coverFor(companyName?: string | null): string {
  if (companyName && COMPANY_COVERS[companyName]) return COMPANY_COVERS[companyName]
  return DEFAULT_COVER
}
