import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 로그인 없는 익명 후기 소유권 관리.
 * - ownerToken: 기기별 영구 랜덤 토큰. 서버는 이 토큰의 해시만 저장하고 응답으로 되돌려주지 않는다.
 * - myReviewIds: 이 기기에서 작성한 후기 id 집합. "내 후기(수정/삭제)" 버튼 노출 판단에 사용.
 * 네이티브 crypto 미사용 — 시간 + Math.random 조합으로 충분히 긴 랜덤 문자열 생성.
 */

const TOKEN_KEY = 'sodate_review_token'
const MY_IDS_KEY = 'sodate_my_review_ids'
const LAST_NICK_KEY = 'sodate_last_nickname'

function generateToken(): string {
  // 40자 이상 보장: 타임스탬프 + Math.random 여러 번 이어붙임
  let token = Date.now().toString(36)
  for (let i = 0; i < 6; i++) {
    token += Math.random().toString(36).slice(2)
  }
  return token
}

/** 기기 소유권 토큰을 가져오거나(없으면) 새로 만들어 저장 후 반환 */
export async function getOrCreateToken(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(TOKEN_KEY)
    if (existing && existing.length >= 40) return existing
    const token = generateToken()
    await AsyncStorage.setItem(TOKEN_KEY, token)
    return token
  } catch {
    // 저장 실패 시에도 세션 내 동작을 위해 임시 토큰 반환
    return generateToken()
  }
}

/** 이 기기에서 작성한 후기 id 목록 */
export async function getMyReviewIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(MY_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 내 후기 id 추가(중복 제거) */
export async function addMyReviewId(id: string): Promise<void> {
  try {
    const ids = await getMyReviewIds()
    if (ids.includes(id)) return
    ids.push(id)
    await AsyncStorage.setItem(MY_IDS_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

/** 내 후기 id 제거(삭제 시) */
export async function removeMyReviewId(id: string): Promise<void> {
  try {
    const ids = await getMyReviewIds()
    const next = ids.filter((v) => v !== id)
    await AsyncStorage.setItem(MY_IDS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

/** 마지막으로 후기 작성/수정에 사용한 닉네임(다음 작성 시 자동 세팅용) */
export async function getLastNickname(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(LAST_NICK_KEY)) ?? ''
  } catch {
    return ''
  }
}

/** 후기 작성/수정 성공 시 닉네임 기억 */
export async function setLastNickname(name: string): Promise<void> {
  try {
    const v = (name ?? '').trim()
    if (v) await AsyncStorage.setItem(LAST_NICK_KEY, v)
  } catch {
    // ignore
  }
}
