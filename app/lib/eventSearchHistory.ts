import AsyncStorage from '@react-native-async-storage/async-storage'

/** 모임 피드 검색 팝업 — 이 기기에서 최근 검색한 단어(2026-08-14). 서버에 안 남기고
 *  기기에만 저장한다(lib/boardSearchHistory.ts와 같은 방식, 커뮤니티 검색과는 별개 목록). */
const KEY = 'sodate_event_recent_searches'
const MAX = 10

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 검색 실행 시 호출 — 맨 앞으로 올리고(이미 있으면 중복 제거), 최대 MAX개만 유지. */
export async function addRecentSearch(term: string): Promise<void> {
  const t = term.trim()
  if (!t) return
  try {
    const list = await getRecentSearches()
    const next = [t, ...list.filter((v) => v !== t)].slice(0, MAX)
    await AsyncStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 저장 실패는 조용히 넘긴다 — 최근 검색어만 안 남을 뿐 검색 자체엔 지장 없음
  }
}

export async function removeRecentSearch(term: string): Promise<void> {
  try {
    const list = await getRecentSearches()
    await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((v) => v !== term)))
  } catch {
    // 무시
  }
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {
    // 무시
  }
}
