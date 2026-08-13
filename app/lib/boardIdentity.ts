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
const TERMS_AGREED = 'sodate_board_terms_agreed'
const BLOCKED = 'sodate_board_blocked_authors'
const SEEN_COMMENT_IDS = 'sodate_board_seen_comment_ids'
const READ_POST_IDS = 'sodate_board_read_posts'

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

/**
 * 내 글에 달린 댓글 중 "읽음" 처리한 id 목록 — 목록 화면 상단 새 댓글 띠(2026-08-12)가
 * 무엇을 새로 보여줄지 판단하는 기준. 서버에 읽음 상태를 두지 않고 기기에만 남긴다
 * (푸시 없이 앱 안에서만 보이면 된다는 오너 지시).
 */
export const getSeenCommentIds = () => readList(SEEN_COMMENT_IDS)

export async function markCommentsSeen(ids: string[]): Promise<void> {
  if (!ids.length) return
  try {
    const list = await readList(SEEN_COMMENT_IDS)
    const set = new Set(list)
    let changed = false
    for (const id of ids) {
      if (!set.has(id)) { set.add(id); changed = true }
    }
    if (changed) await AsyncStorage.setItem(SEEN_COMMENT_IDS, JSON.stringify(Array.from(set)))
  } catch {
    // ignore
  }
}

/**
 * 내가 읽은 글 — 목록에서 연하게 표시하기 위한 기록(2026-08-13 오너 지시). 서버에 안 남기고
 * 기기에만 남긴다(로그인 없는 익명 게시판이라 서버가 '누가 읽었는지' 알 이유가 없다).
 * 계속 쌓이는 목록이라(다른 '내 것' 목록과 달리 글쓴 것만큼만 늘지 않음) 무한정 커지지
 * 않게 최근 READ_POST_MAX개만 남긴다.
 */
const READ_POST_MAX = 1000
export const getReadPostIds = () => readList(READ_POST_IDS)

export async function markPostRead(id: string): Promise<void> {
  try {
    const list = await readList(READ_POST_IDS)
    if (list.includes(id)) return
    list.push(id)
    const trimmed = list.length > READ_POST_MAX ? list.slice(list.length - READ_POST_MAX) : list
    await AsyncStorage.setItem(READ_POST_IDS, JSON.stringify(trimmed))
  } catch {
    // 저장 실패는 조용히 넘긴다 — 읽음 표시만 안 될 뿐 글은 정상적으로 보인다
  }
}

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

/** 이용약관(게시물 관련 조항) 동의 여부. 한 번 동의하면 기기에 남아 다시 묻지 않는다. */
export async function getTermsAgreed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TERMS_AGREED)) === '1'
  } catch {
    return false
  }
}

export async function setTermsAgreed(): Promise<void> {
  try {
    await AsyncStorage.setItem(TERMS_AGREED, '1')
  } catch {
    // ignore
  }
}

/**
 * 작성자 차단(뮤트) — 애플 1.2 요건. 서버가 글·댓글마다 내려주는 owner_token
 * (기기 시크릿의 해시, 원래 값으로 되돌릴 수 없음)을 기준으로 같은 기기가 쓴
 * 글·댓글을 전부 가린다. 닉네임은 목록에 보여주기 위해 함께 저장할 뿐, 판단
 * 기준은 아니다(닉네임은 바뀔 수 있다).
 */
export type BlockedAuthor = { key: string; nickname: string }

async function readBlocked(): Promise<BlockedAuthor[]> {
  try {
    const raw = await AsyncStorage.getItem(BLOCKED)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const getBlockedAuthors = readBlocked

export async function isBlockedAuthor(key: string | null | undefined): Promise<boolean> {
  if (!key) return false
  const list = await readBlocked()
  return list.some((b) => b.key === key)
}

export async function blockAuthor(key: string, nickname: string): Promise<void> {
  try {
    const list = await readBlocked()
    if (list.some((b) => b.key === key)) return
    list.push({ key, nickname })
    await AsyncStorage.setItem(BLOCKED, JSON.stringify(list))
  } catch {
    // ignore
  }
}

export async function unblockAuthor(key: string): Promise<void> {
  try {
    const list = await readBlocked()
    await AsyncStorage.setItem(BLOCKED, JSON.stringify(list.filter((b) => b.key !== key)))
  } catch {
    // ignore
  }
}
