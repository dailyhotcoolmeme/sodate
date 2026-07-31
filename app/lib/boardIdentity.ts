import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * 게시판에서 '내 것'을 기억한다.
 *
 * ⚠️ 서버가 저장하는 owner_token(기기 시크릿의 해시)은 앱에 내려주지 않는다.
 *    그 값이 조회에 섞이면 같은 기기가 쓴 글을 전부 묶어낼 수 있어, 익명 게시판에서는
 *    그것만으로 신원이 드러난다. 그래서 후기와 같은 방식으로 내가 쓴 id만 기기에 남긴다.
 *    (기기를 바꾸거나 앱을 지우면 수정·삭제 권한을 잃는 건 후기와 동일한 한계다.)
 */

const POST_IDS = 'sodate_board_my_posts'
const COMMENT_IDS = 'sodate_board_my_comments'
const VOTES = 'sodate_board_my_votes'

async function readList(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

async function addTo(key: string, id: string): Promise<void> {
  try {
    const list = await readList(key)
    if (list.includes(id)) return
    list.push(id)
    await AsyncStorage.setItem(key, JSON.stringify(list))
  } catch {
    // 저장 실패는 조용히 넘긴다 — 수정·삭제 버튼이 안 보일 뿐이다
  }
}

async function removeFrom(key: string, id: string): Promise<void> {
  try {
    const list = await readList(key)
    await AsyncStorage.setItem(key, JSON.stringify(list.filter((v) => v !== id)))
  } catch {
    // ignore
  }
}

export const getMyPostIds = () => readList(POST_IDS)
export const addMyPostId = (id: string) => addTo(POST_IDS, id)
export const removeMyPostId = (id: string) => removeFrom(POST_IDS, id)

export const getMyCommentIds = () => readList(COMMENT_IDS)
export const addMyCommentId = (id: string) => addTo(COMMENT_IDS, id)
export const removeMyCommentId = (id: string) => removeFrom(COMMENT_IDS, id)

/** 글마다 내가 누른 추천·비추. 0은 누르지 않은 상태. */
export async function getMyVotes(): Promise<Record<string, 1 | -1>> {
  try {
    const raw = await AsyncStorage.getItem(VOTES)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function setMyVote(postId: string, value: 0 | 1 | -1): Promise<void> {
  try {
    const all = await getMyVotes()
    if (value === 0) delete all[postId]
    else all[postId] = value
    await AsyncStorage.setItem(VOTES, JSON.stringify(all))
  } catch {
    // ignore
  }
}
