// 이미지 없는 업체용 "고정 배경 이미지" — 업체별 테마에 맞는 스톡 사진(Unsplash).
// 이벤트 썸네일이 없거나 로고/플레이스홀더/로딩실패면 이 배경 위에 텍스트를 오버레이한다.
// 새 업체는 여기 한 줄만 추가하면 됨(없으면 DEFAULT 사용).

const P = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=800&q=80&fit=crop&crop=entropy&auto=format`

export const COMPANY_COVERS: Record<string, string> = {
  '연인어때': P('1519671282429-b44660ead0a7'),      // 친구들 식사·모임
  '토크블라썸': P('1516600164266-f3b8166ae679'),    // 와인 건배
  '모드파티': P('1628551093316-4a5f29d3bd02'),      // 활기찬 바
  '러브캐스팅': P('1517701986616-711a9d625afe'),    // 커피 네온
  '괜찮소': P('1650075285364-5f28562dfd05'),        // 대리석 카페
  '시크릿살롱': P('1575184560884-5f3ece6e636c'),    // 무드있는 와인바
  '인썸파티': P('1513618827672-0d7c5ad591b1'),      // 와인
  '프립': P('1542181961-9590d0c79dab'),             // 감성 카페
  '문토': P('1590741861173-85035e8af62c'),          // 카페 인테리어
  '에모셔널오렌지': P('1596517447156-4408f27791ae'),
  '러브커뮤니티': P('1516197370049-569c4eaba1d6'),
}

export const DEFAULT_COVER = P('1516197370049-569c4eaba1d6') // 소셜 카페

export function coverFor(companyName?: string | null): string {
  if (companyName && COMPANY_COVERS[companyName]) return COMPANY_COVERS[companyName]
  return DEFAULT_COVER
}
