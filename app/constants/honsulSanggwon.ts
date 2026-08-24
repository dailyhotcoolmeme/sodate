/**
 * 혼술바 상권(좌표 기반 자동 분류). region(동)이 아니라 상권으로 필터한다(오너 확정).
 * 각 상권의 대표 좌표를 두고, 매장을 가장 가까운 상권(반경 내)에 배정한다.
 * 반경 밖 매장은 어떤 상권에도 안 붙고 '전체'에서만 보인다(밀집 상권 위주 필터).
 * 좌표는 실제 매장 밀집 중심(클러스터 분석, 2026-08-24)에서 뽑음.
 */
export type Sanggwon = { name: string; lat: number; lng: number }

export const SANGGWON: Sanggwon[] = [
  // 서울
  { name: '홍대', lat: 37.5496, lng: 126.9206 },
  { name: '연남동', lat: 37.5619, lng: 126.9253 },
  { name: '을지로·충무로', lat: 37.5641, lng: 126.9923 },
  { name: '이태원', lat: 37.5347, lng: 126.9925 },
  { name: '건대', lat: 37.5419, lng: 127.0692 },
  { name: '성수', lat: 37.5466, lng: 127.0468 },
  { name: '군자', lat: 37.5583, lng: 127.0792 },
  { name: '성신여대', lat: 37.5908, lng: 127.0198 },
  { name: '방이동', lat: 37.5143, lng: 127.1093 },
  { name: '천호', lat: 37.5390, lng: 127.1281 },
  { name: '강남', lat: 37.4979, lng: 127.0276 },
  { name: '신림', lat: 37.4815, lng: 126.9299 },
  { name: '서울대입구', lat: 37.4795, lng: 126.9554 },
  { name: '문래·영등포', lat: 37.5166, lng: 126.8965 },
  { name: '마곡', lat: 37.5634, lng: 126.8331 },
  // 경기·인천
  { name: '수원역', lat: 37.2684, lng: 127.0017 },
  { name: '수원 인계동', lat: 37.2661, lng: 127.0305 },
  { name: '성남', lat: 37.4334, lng: 127.1338 },
  { name: '의정부', lat: 37.7400, lng: 127.0494 },
  { name: '김포 구래', lat: 37.6442, lng: 126.6239 },
  { name: '인천 구월동', lat: 37.4455, lng: 126.7023 },
  { name: '인천 부평', lat: 37.4926, lng: 126.7264 },
  // 부산
  { name: '부산 서면', lat: 35.1561, lng: 129.0639 },
  { name: '부산 광안리', lat: 35.1532, lng: 129.1172 },
  // 대전·창원
  { name: '대전 궁동', lat: 36.3593, lng: 127.3470 },
  { name: '창원 상남동', lat: 35.2212, lng: 128.6817 },
  // 제주
  { name: '제주시청', lat: 33.5132, lng: 126.5229 },
  { name: '제주 연동', lat: 33.4864, lng: 126.4883 },
  { name: '서귀포', lat: 33.2483, lng: 126.5627 },
]

// 배정 반경(도). 위도 0.018°≈2km — 상권 중심에서 이 안이면 그 상권으로.
const MAX_DEG = 0.02

/** 위경도 → 가장 가까운 상권명(반경 내). 밖이면 null. */
export function sanggwonFor(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null
  let best: string | null = null
  let bestD = Infinity
  for (const s of SANGGWON) {
    const dLat = lat - s.lat
    // 경도는 위도(≈37°)에서 약 0.79배 압축 — 대략 보정
    const dLng = (lng - s.lng) * 0.8
    const d = dLat * dLat + dLng * dLng
    if (d < bestD) { bestD = d; best = s.name }
  }
  return bestD <= MAX_DEG * MAX_DEG ? best : null
}
