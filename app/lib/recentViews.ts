import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 최근 본 것 — MY 탭 "최근 본 것"의 저장소(2026-08-21). 완전히 로컬(AsyncStorage).
 * 이벤트/업체 상세에 들어갈 때마다 여기 한 줄을 남긴다. 서버로 안 나간다.
 *
 * 소셜링·혼술바가 붙으면 kind 를 늘려 같은 목록에 섞어 보여줄 수 있게 kind 로 구분한다.
 */
const KEY = 'sodate_recent_views'
const MAX = 50

export type RecentKind = 'event' | 'company'

export interface RecentView {
  kind: RecentKind
  id: string
  title: string
  /** 카드 보조 줄 — 업체명·지역 등. 없으면 생략. */
  sub?: string
  /** 본 시각(epoch ms). 최신순 정렬·표시용. */
  at: number
}

export async function getRecentViews(): Promise<RecentView[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as RecentView[]) : []
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
