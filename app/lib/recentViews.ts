import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 최근 본 것 — MY 탭 "최근 본 기록"의 저장소(2026-08-21, 2026-08-24 kind 세분화).
 * 완전히 로컬(AsyncStorage). 일정/업체/매장 상세에 들어갈 때마다 여기 한 줄을 남긴다.
 * 서버로 안 나간다.
 *
 * kind 로 소개팅·소셜링·혼술바·업체를 구분한다("전체" 탭에서 종류별 아이콘 표시,
 * 소개팅/소셜링/혼술바 탭에서 필터링에 쓴다). 'company'(업체 소개 페이지)는 특정
 * 소개팅/소셜링 이벤트가 아니라 업체 단위라 3개 탭 어디에도 넣지 않고 전체에서만 보여준다.
 */
const KEY = 'sodate_recent_views'
const MAX = 50

export type RecentKind = 'dating' | 'socialing' | 'place' | 'company'

export interface RecentView {
  kind: RecentKind
  id: string
  title: string
  /** 카드 보조 줄 — 업체명·지역 등. 없으면 생략. */
  sub?: string
  /** 본 시각(epoch ms). 최신순 정렬·표시용. */
  at: number
}

/** kind 세분화(2026-08-24) 이전 기록은 전부 'event'였다 — 소개팅으로 간주해 마이그레이션한다.
 *  (그 시점엔 소셜링도 이 kind 하나로 저장됐지만, 원본 event_type 정보가 로컬엔 없어
 *  되살릴 수 없다 — 다시 열람하면 새 kind로 갱신된다.) */
function migrateKind(kind: string): RecentKind {
  return kind === 'event' ? 'dating' : (kind as RecentKind)
}

export async function getRecentViews(): Promise<RecentView[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecentView[]
    return list.map((v) => ({ ...v, kind: migrateKind(v.kind as string) }))
  } catch {
    return []
  }
}

/** 같은 kind+id 는 최신 것으로 끌어올린다(중복 제거). 최대 MAX 개까지만 남긴다. */
export async function addRecentView(item: Omit<RecentView, 'at'>): Promise<void> {
  try {
    const list = await getRecentViews()
    const filtered = list.filter((v) => !(v.kind === item.kind && v.id === item.id))
    filtered.unshift({ ...item, at: Date.now() })
    await AsyncStorage.setItem(KEY, JSON.stringify(filtered.slice(0, MAX)))
  } catch {
    // ignore — 기록 실패가 화면을 막으면 안 된다
  }
}

export async function clearRecentViews(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
