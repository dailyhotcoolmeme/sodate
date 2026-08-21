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
const BOARD_VISITED = 'sodate_board_visited'
// 토글 안내 말풍선 상태(아래 getToggleTip 주석 참고). BOARD_VISITED 와 따로 둔다 —
// 그건 오른쪽 스와이프 힌트카드가 쓰는 값이라 같이 쓰면 서로 얽힌다.
const TOGGLE_TIP = 'sodate_board_toggle_tip'
const SCRAPS = 'sodate_board_scraps'

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

/**
 * 커뮤니티(게시판)에 한 번이라도 들어가 본 적 있는 기기인지(2026-08-14 오너 지시).
 * 모임 피드 화면의 스와이프 힌트(오른쪽 끝에서 통통 튀는 화살표)를 이 기기에서
 * 커뮤니티를 한 번도 안 가봤을 때만 보여주기 위한 기록 — 한 번이라도 들어가면
 * 그 뒤로는 영구히 안 뜬다(다시 보여줄 이유가 없다).
 */
export async function getBoardVisited(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BOARD_VISITED)) === '1'
  } catch {
    return false
  }
}

export async function markBoardVisited(): Promise<void> {
  try {
    await AsyncStorage.setItem(BOARD_VISITED, '1')
  } catch {
    // ignore
  }
}

/**
 * 커뮤니티 톱바 토글 안내 말풍선의 상태.
 *
 * 커뮤니티로 오는 길이 셋(토글·스와이프·햄버거 메뉴)인데, 토글을 모르고 다른 길로만
 * 다니는 사람에게 "토글 버튼으로 바로 올 수 있어요"를 한 번 알려준다(2026-08-20 오너 지시).
 *
 *   null      아직 커뮤니티에 처음 들어오기 전
 *   'pending' 첫 진입이 토글이 아니었다 → 닫을 때까지 계속 띄운다
 *   'done'    띄울 필요 없음(토글로 첫 진입했거나, 사용자가 닫기를 눌렀거나)
 *
 * 상태 하나로 "첫 진입을 어떻게 했나"와 "닫았나"를 둘 다 표현하므로 키가 하나면 된다.
 * 자동으로 사라지지 않는다 — 오직 닫기를 눌러야 'done' 이 된다(오너 결정).
 */
export type ToggleTipState = null | 'pending' | 'done'

export async function getToggleTip(): Promise<ToggleTipState> {
  try {
    const v = await AsyncStorage.getItem(TOGGLE_TIP)
    return v === 'pending' || v === 'done' ? v : null
  } catch {
    // 못 읽으면 '아직 결정 안 됨'이 아니라 '띄우지 않음'으로 본다 — 읽기 실패 때문에
    // 매번 말풍선이 뜨는 쪽이 훨씬 나쁘다.
    return 'done'
  }
}

export async function setToggleTip(v: Exclude<ToggleTipState, null>): Promise<void> {
  try {
    await AsyncStorage.setItem(TOGGLE_TIP, v)
  } catch {
    // ignore
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

// ── 스크랩(북마크) 로컬 캐시 ── 2026-08-21
// 서버(board_scraps)가 정본이지만, 글 상세에서 스크랩 버튼을 누르는 즉시 채워진 하트로
// 보이려면 로컬에도 상태를 둔다(votes 와 같은 방식). MY "스크랩한 글" 목록은 서버에서
// 다시 받아 그린다 — 로컬은 버튼 상태 표시용일 뿐 목록의 정본이 아니다.
export async function getScrappedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SCRAPS)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export async function isScrapped(postId: string): Promise<boolean> {
  return (await getScrappedIds()).has(postId)
}

export async function setScrapped(postId: string, on: boolean): Promise<void> {
  try {
    const all = await getScrappedIds()
    if (on) all.add(postId)
    else all.delete(postId)
    await AsyncStorage.setItem(SCRAPS, JSON.stringify([...all]))
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
