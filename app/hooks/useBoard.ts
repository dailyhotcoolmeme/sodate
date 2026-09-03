import { useState, useEffect, useCallback, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { getMyPostIds, getMyCommentIds, getMyVotes, getBlockedAuthors, getSeenCommentIds } from '@/lib/boardIdentity'
import { fetchSecretComments } from '@/lib/board'
import type { BoardPost, BoardComment, BoardSettings, BoardTag } from '@/lib/board'

/**
 * 게시판 조회. 쓰기는 Edge Function(lib/board.ts), 읽기는 RLS로 직접 한다.
 *
 * 목록은 번호 페이지 방식이다(오너 확정). 무한 스크롤이 아니라서 range 로 잘라 읽고
 * 전체 건수를 함께 받아 페이지 수를 계산한다.
 *
 * '내 것' 판단은 기기에 저장한 id 목록으로 한다(lib/boardIdentity.ts).
 *
 * owner_token(기기 시크릿의 해시)은 작성자 차단(뮤트) 기준으로 쓰기 위해 목록·상세에
 * 함께 받아온다(2026-08 애플 1.2 대응, 오너 승인). 원래 기기값으로 되돌릴 수 없는
 * 해시라 이 값만으로 실제 신원이 드러나지는 않지만, 같은 기기가 쓴 글·닉네임끼리는
 * 서로 연결해 볼 수 있게 된다는 점은 의도된 트레이드오프다.
 */

export const PAGE_SIZE = 20

// 목록에 실제로 그리는 컬럼만 받는다. 예전엔 본문(content)까지 다 받아왔는데 목록에서는
// 본문을 한 글자도 안 쓴다(2026-09-03).
const LIST_COLUMNS =
  'id,nickname,avatar_id,title,image_urls,link_urls,tag_id,board_tags(label),' +
  'upvotes,downvotes,comment_count,owner_token,is_notice,created_at'

/**
 * 첫 화면을 흰 채로 두지 않기 위한 두 가지 장치 — 2026-09-03 오너 지시
 * ("커뮤니티 흰 화면에서 스피너가 꽤 걸리는데 개선 어렵나").
 *
 * 실측(2026-09-03): 앱을 켜고 **첫 번째** 서버 조회가 2,540ms, 두 번째부터는 500~645ms,
 * 연결이 살아 있으면 300ms. 즉 기다림의 대부분이 글을 받는 시간이 아니라 **서버와 처음
 * 연결을 맺는 시간**이다. 서버를 빠르게 해도 이건 안 줄어든다. 그래서 두 갈래로 푼다.
 *
 *  1) 지난번 목록을 기기에 저장해 뒀다가 **즉시** 그린다 → 흰 화면 자체가 없어진다.
 *  2) 화면이 마운트되기 전에 조회를 **미리 시작**한다(prefetchBoardList) → 화면이 뜰 때
 *     이미 응답이 와 있거나, 최소한 연결은 맺혀 있다.
 */
const CACHE_KEY = 'sodate-board-list-v1'
/** 미리 받아둔 응답을 이만큼까지는 그대로 쓴다. 넘으면 버리고 새로 받는다. */
const PREFETCH_TTL_MS = 15_000

type ListResult = { data: unknown; count: number | null; error: unknown }
let prefetched: { at: number; promise: Promise<ListResult> } | null = null

function firstPageQuery() {
  return supabase
    .from('board_posts')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('is_active', true)
    .order('is_notice', { ascending: false })
    .order('created_at', { ascending: false })
    .range(0, PAGE_SIZE - 1)
    .then((r) => ({ data: r.data, count: r.count, error: r.error })) as Promise<ListResult>
}

/**
 * 목록 1페이지를 미리 받아둔다. 앱 시작 직후(_layout)에서 부른다 — 커뮤니티 화면이
 * 그려지기를 기다리지 않고 바로 던져야 첫 왕복 시간을 화면 준비 시간과 겹칠 수 있다.
 * 실패해도 조용히 무시한다. 화면이 어차피 다시 조회한다.
 */
export function prefetchBoardList() {
  prefetched = { at: Date.now(), promise: firstPageQuery().catch(() => ({ data: null, count: null, error: true })) }
}

/** 목록·상세에서 조인해 온 말머리. 비활성화된 말머리도 과거 글에서는 그대로 보인다
 *  (조인 자체에는 is_active 조건을 안 건다 — useBoardTags 와의 차이). */
export type BoardPostWithTag = BoardPost & { board_tags: { label: string } | null }

/**
 * 말머리 선택지(글쓰기 화면) — admin(board_tags)에서 등록한 것 중 사용 중인 것만
 * 보여준다(2026-08-12 오너 지시, 코드에 종류를 박아두지 않는다). 목록·상세에서
 * 이미 붙은 말머리를 표시할 때는 이 목록이 아니라 board_posts 조회에 묶어 온
 * 라벨을 그대로 쓴다 — 비활성화된 말머리도 과거 글에서는 보여야 하기 때문.
 */
export function useBoardTags() {
  const [tags, setTags] = useState<BoardTag[]>([])
  useEffect(() => {
    supabase.from('board_tags').select('id,label,sort_order,is_active,created_at')
      .eq('is_active', true).order('sort_order', { ascending: true })
      .then(({ data }) => setTags((data as unknown as BoardTag[]) ?? []), () => {})
  }, [])
  return tags
}

/** 굵게·흐리게 기준은 DB(board_settings)에서 읽는다 — 코드 수정 없이 바꿀 수 있어야 한다. */
export function useBoardSettings() {
  const [settings, setSettings] = useState<BoardSettings | null>(null)
  useEffect(() => {
    supabase.from('board_settings').select('*').eq('id', true).single()
      .then(({ data }) => setSettings((data as unknown as BoardSettings) ?? null), () => {})
  }, [])
  return settings
}

export function useBoardList(page: number, search = '') {
  const [posts, setPosts] = useState<BoardPostWithTag[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // ⚠️(2026-08-13) 예전엔 조회가 실패해도 posts=[] 그대로 두고 loading만 꺼서, 화면엔
  // "아직 글이 없어요"가 떴다 — 진짜 빈 상태와 구분이 안 돼 게시판이 통째로 고장났는데
  // (컬럼 rename 사고 2연타로 실제 겪음) 아무도 못 알아챘다. supabase-js는 DB 에러여도
  // reject가 아니라 {data:null,error} 로 resolve하므로 성공 콜백 안에서 error를 봐야 한다.
  const [error, setError] = useState(false)
  // 저장해 둔 목록으로 먼저 그린 상태인지. 서버 응답이 오면 덮어쓴다.
  const servedFromCache = useRef(false)
  // setState 는 비동기라 콜백 안에서 loading 을 바로 못 읽는다 → ref 로 따로 들고 있는다.
  const loadingRef = useRef(true)

  const isFirstPage = page === 0 && !search.trim()

  useEffect(() => { loadingRef.current = loading }, [loading])

  // ── 1) 저장해 둔 목록을 즉시 그린다 ─────────────────────────────────────
  // 서버 왕복(콜드 2.5초)을 기다리는 동안 흰 화면을 보여주지 않기 위한 것이다. 화면에
  // 보이는 건 지난번에 본 목록이고, 아래 조회가 끝나면 조용히 갈아끼운다.
  useEffect(() => {
    if (!isFirstPage) return
    let alive = true
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (!alive || !raw) return
      try {
        const c = JSON.parse(raw) as { posts: BoardPostWithTag[]; total: number }
        // 서버 응답이 이미 왔으면 옛 목록으로 되돌리지 않는다.
        if (!alive || !c?.posts?.length || !loadingRef.current) return
        servedFromCache.current = true
        setPosts(c.posts)
        setTotal(c.total ?? c.posts.length)
        setLoading(false)
      } catch {
        // 저장값이 깨졌으면 그냥 무시하고 서버 응답을 기다린다
      }
    })
    return () => { alive = false }
  }, [isFirstPage])

  const load = useCallback(() => {
    // 저장해 둔 목록을 이미 그렸다면 스피너로 되돌리지 않는다 — 화면이 깜빡인다.
    if (!servedFromCache.current) setLoading(true)
    loadingRef.current = true

    const finish = ({ data, count, error: err }: ListResult) => {
      if (err) {
        // 저장해 둔 목록이라도 보이고 있으면 오류 화면으로 갈아치우지 않는다.
        if (!servedFromCache.current) setError(true)
        setLoading(false)
        loadingRef.current = false
        return
      }
      getBlockedAuthors().then((blocked) => {
        const blockedKeys = new Set(blocked.map((b) => b.key))
        const rows = (data as unknown as BoardPostWithTag[]) ?? []
        const visible = blockedKeys.size ? rows.filter((p) => !blockedKeys.has(p.owner_token)) : rows
        setPosts(visible)
        setTotal(count ?? 0)
        setError(false)
        setLoading(false)
        loadingRef.current = false
        servedFromCache.current = false
        // 다음 실행 때 즉시 그릴 수 있게 1페이지만 저장해 둔다(차단 반영된 목록으로).
        if (isFirstPage) {
          AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ posts: visible, total: count ?? 0 })).catch(() => {})
        }
      })
    }

    // ── 2) 앱 시작 때 미리 던져둔 응답이 있으면 그걸 쓴다 ────────────────
    if (isFirstPage && prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS) {
      const p = prefetched.promise
      prefetched = null   // 한 번만 쓴다. 새로고침은 진짜로 다시 받아야 한다.
      p.then(finish, () => finish({ data: null, count: null, error: true }))
      return
    }

    const from = page * PAGE_SIZE
    let q = supabase
      .from('board_posts')
      .select(LIST_COLUMNS, { count: 'exact' })
      .eq('is_active', true)

    const term = search.trim()
    if (term) {
      // 제목 + 본문. 쉼표·괄호는 or 구문의 구분자라 검색어에 들어가면 질의가 깨진다.
      const safe = term.replace(/[,()]/g, ' ')
      // 아랫글(content_below)도 검색 대상에 포함 — 안 하면 첨부 아래에만 쓴 단어가 안 잡힌다.
      q = q.or(`title.ilike.%${safe}%,content.ilike.%${safe}%,content_below.ilike.%${safe}%`)
    }

    // 공지를 맨 위에 고정한다(2026-09-01 오너 지시). 여러 개면 전부 위에 최신순으로.
    // ⚠️ 정렬 키로 올리는 방식이라 공지는 1페이지 상단에만 모인다 — 2페이지부터는 안 보인다.
    //    공지가 페이지마다 반복되지 않아야 하므로 이게 맞다.
    q.order('is_notice', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
      .then(
        (r) => finish({ data: r.data, count: r.count, error: r.error }),
        () => finish({ data: null, count: null, error: true }),
      )
  }, [page, search, isFirstPage])

  useEffect(() => { load() }, [load])

  return {
    posts, total, loading, error, refetch: load,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  }
}

export function useBoardPost(id: string) {
  const [post, setPost] = useState<BoardPostWithTag | null>(null)
  const [postBlocked, setPostBlocked] = useState(false)
  const [comments, setComments] = useState<BoardComment[]>([])
  const [myVote, setMyVote] = useState<0 | 1 | -1>(0)
  const [isMine, setIsMine] = useState(false)
  const [myCommentIds, setMyCommentIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  /** DB 조회 자체가 실패한 경우 — "글을 못 찾음"과 구분해야 한다(2026-08-13, 아래 참고). */
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [{ data: p, error: pErr }, { data: c, error: cErr }] = await Promise.all([
        supabase.from('board_posts')
          .select('id,nickname,avatar_id,title,content,content_below,image_urls,link_urls,tag_id,board_tags(label),upvotes,downvotes,comment_count,view_count,content_hidden,owner_token,is_notice,is_active,created_at,updated_at')
          .eq('id', id).maybeSingle(),
        supabase.from('board_comments')
          .select('id,post_id,parent_id,nickname,avatar_id,content,owner_token,is_secret,created_at,updated_at')
          .eq('post_id', id).eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])
      // ⚠️ 조회 실패(컬럼 오류·권한 문제 등)를 "글이 없음"으로 오인하면 안 된다 —
      // supabase-js는 DB 에러여도 reject가 아니라 {data:null,error}로 resolve한다.
      if (pErr || cErr) {
        setError(true)
        return
      }
      setError(false)
      const blocked = await getBlockedAuthors()
      const blockedKeys = new Set(blocked.map((b) => b.key))
      const postRow = (p as unknown as BoardPostWithTag) ?? null
      setPost(postRow)
      setPostBlocked(!!postRow && blockedKeys.has(postRow.owner_token))
      let commentRows = (c as unknown as BoardComment[]) ?? []
      if (blockedKeys.size) commentRows = commentRows.filter((cm) => !blockedKeys.has(cm.owner_token))

      // 비밀 댓글은 content 가 비어서 온다. 볼 자격이 있으면 서버가 본문을 내려주므로
      // 받아서 채워 넣는다 — 자격이 없으면 그대로 빈 값이라 화면에 자물쇠만 보인다.
      if (commentRows.some((cm) => cm.is_secret)) {
        const secrets = await fetchSecretComments({ postId: id })
        commentRows = commentRows.map((cm) =>
          cm.is_secret && secrets[cm.id] != null ? { ...cm, content: secrets[cm.id] } : cm
        )
      }
      setComments(commentRows)

      const [mine, myComments, votes] = await Promise.all([
        getMyPostIds(), getMyCommentIds(), getMyVotes(),
      ])
      setIsMine(mine.includes(id))
      setMyCommentIds(myComments)
      setMyVote(votes[id] ?? 0)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  return { post, postBlocked, comments, myVote, isMine, myCommentIds, loading, error, refetch: load, setMyVote }
}

/** 내가 쓴 글 (햄버거 → 내가 쓴 글) */
export function useMyPosts() {
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const ids = await getMyPostIds()
      if (!ids.length) {
        setPosts([])
        return
      }
      const { data } = await supabase.from('board_posts')
        .select('id,nickname,title,content,upvotes,downvotes,comment_count,is_active,created_at')
        .in('id', ids)
        .order('created_at', { ascending: false })
      setPosts((data as unknown as BoardPost[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { posts, loading, refetch: load }
}

/** 내 댓글 한 줄 — 어느 글에 달았는지 알아야 눌렀을 때 그 글로 갈 수 있다. */
export type MyComment = {
  id: string
  post_id: string
  content: string
  is_secret: boolean
  is_active: boolean
  created_at: string
  post_title: string | null
  /** 글 자체가 지워졌으면(post_title 이 null) 눌러도 갈 곳이 없다 */
}

/**
 * 내가 쓴 댓글 (햄버거 → 내가 쓴 글 → 댓글 탭).
 * 디시인사이드·루리웹·클리앙·Reddit 전부 글/댓글을 탭으로 나눠 보여준다
 * (2026-08-01 외부 조사로 확인, 오너 승인).
 */
export function useMyComments() {
  const [comments, setComments] = useState<MyComment[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const ids = await getMyCommentIds()
      if (!ids.length) {
        setComments([])
        return
      }
      const { data } = await supabase.from('board_comments')
        .select('id,post_id,content,is_secret,is_active,created_at,board_posts(title)')
        .in('id', ids)
        .order('created_at', { ascending: false })
      const mapped = ((data ?? []) as unknown as Array<{
        id: string; post_id: string; content: string; is_secret: boolean
        is_active: boolean; created_at: string
        board_posts: { title: string } | null
      }>).map((c) => ({
        id: c.id, post_id: c.post_id, content: c.content, is_secret: c.is_secret,
        is_active: c.is_active, created_at: c.created_at,
        post_title: c.board_posts?.title ?? null,
      }))
      // 내가 쓴 비밀 댓글도 본문이 비어서 온다 — 내 것이니 서버가 내려준다.
      const secretIds = mapped.filter((c) => c.is_secret).map((c) => c.id)
      if (secretIds.length) {
        const secrets = await fetchSecretComments({ commentIds: secretIds })
        setComments(mapped.map((c) =>
          c.is_secret && secrets[c.id] != null ? { ...c, content: secrets[c.id] } : c
        ))
        return
      }
      setComments(mapped)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { comments, loading, refetch: load }
}

/** 내 글 하나에 달린, 아직 안 읽은 댓글 묶음 — 목록 화면 상단 새 댓글 띠용. */
export type MyPostNewCommentGroup = {
  postId: string
  postTitle: string
  count: number
  /** 오래된 순 — [0]이 이 글에서 가장 먼저 안 읽은 댓글이라 거기로 이동한다 */
  commentIds: string[]
}

/**
 * 목록 화면 상단 "새 댓글 +N개" 띠(2026-08-12 오너 지시). 내 글에 달린 댓글 중
 * 내가 쓰지 않았고(getMyCommentIds 로 제외) 아직 안 읽은(getSeenCommentIds 에 없는)
 * 것만 센다. 푸시는 쓰지 않고 앱에서만 보이면 되므로 읽음 표시도 기기에만 남긴다.
 */
export function useMyPostNewComments() {
  const [groups, setGroups] = useState<MyPostNewCommentGroup[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const postIds = await getMyPostIds()
      if (!postIds.length) {
        setGroups([])
        return
      }
      const [myCommentIds, seenIds, blocked, { data }] = await Promise.all([
        getMyCommentIds(),
        getSeenCommentIds(),
        getBlockedAuthors(),
        supabase.from('board_comments')
          .select('id,post_id,owner_token,created_at,board_posts(title)')
          .in('post_id', postIds).eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])
      const mySet = new Set(myCommentIds)
      const seenSet = new Set(seenIds)
      const blockedKeys = new Set(blocked.map((b) => b.key))
      const byPost = new Map<string, MyPostNewCommentGroup & { latestAt: string }>()
      for (const row of (data ?? []) as unknown as Array<{
        id: string; post_id: string; owner_token: string; created_at: string
        board_posts: { title: string } | null
      }>) {
        if (mySet.has(row.id) || seenSet.has(row.id)) continue
        // 차단한 작성자의 댓글은 상세 화면에서 걸러지므로 배너에서도 빼야 한다. 안 그러면
        // "+1개"를 눌러 들어갔는데 아무것도 없는 상태가 된다(2026-08-13 감사).
        if (blockedKeys.has(row.owner_token)) continue
        // 내 글이 신고로 숨겨지면 board_posts 조인이 RLS 에 막혀 제목이 null 로 온다.
        // 눌러도 볼 수 없는 글이므로 배너에 올리지 않는다(제목만 빈 줄로 뜨던 문제).
        if (!row.board_posts?.title) continue
        const g = byPost.get(row.post_id) ?? {
          postId: row.post_id, postTitle: row.board_posts.title, count: 0, commentIds: [], latestAt: row.created_at,
        }
        g.count += 1
        g.commentIds.push(row.id)
        g.latestAt = row.created_at
        byPost.set(row.post_id, g)
      }
      // 가장 최근에 댓글이 달린 내 글이 위로 오게(오래된 것 뒤로).
      setGroups(Array.from(byPost.values()).sort((a, b) => b.latestAt.localeCompare(a.latestAt)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { groups, loading, refetch: load }
}

/**
 * 어떤 작성자(기기 하나)가 쓴 글·댓글 — 커뮤니티에서 닉네임을 누르면 열린다.
 *
 * ## 왜 닉네임이 아니라 owner_token 으로 묶는가 (2026-08-19 오너 결정)
 *
 * 이 게시판은 닉네임을 글마다 자유롭게 입력한다. 실제 데이터를 세어보니:
 *
 *   글 51 · 댓글 138 → 고유 닉네임 53개 vs 고유 기기 13개
 *   · 'ㅇㅇ' 하나를 **서로 다른 5명**이 쓰고 있었다(ㅋㅋ 3명, ㅋㅋㅋ 2명, ㅇㅇㅇ 2명)
 *   · 반대로 한 사람이 닉네임을 **24개**까지 돌려쓰고 있었다
 *
 * 닉네임으로 묶으면 남의 글이 섞여 나와 그냥 버그로 보인다. 그래서 기기 기준으로 묶는다.
 * owner_token 은 차단(뮤트) 기능 때문에 이미 목록·상세 응답에 들어 있어 추가 노출은 없다.
 *
 * ⚠️ 대신 "닉네임을 바꿔 써도 같은 사람으로 묶인다"는 성질이 생긴다. 오너가 이 점을
 *    알고 고른 선택이다(닉네임 기준은 애초에 결과가 틀린다). 화면에도 그렇게 안내한다.
 *
 * ## 비밀 댓글은 넣지 않는다
 * 비밀 댓글은 글 작성자와 당사자만 볼 수 있는 기능이라(개인정보처리방침 1항) 여기서
 * 목록으로 보여주면 열람 범위가 깨진다. 내용은 물론 존재 자체를 빼서 카운트에도 안 넣는다.
 */
export type AuthorPost = {
  id: string
  nickname: string
  title: string
  comment_count: number
  upvotes: number
  downvotes: number
  created_at: string
}

export type AuthorComment = {
  id: string
  post_id: string
  nickname: string
  content: string
  created_at: string
  post_title: string | null
}

export function useAuthorActivity(ownerToken: string | undefined) {
  const [posts, setPosts] = useState<AuthorPost[]>([])
  const [comments, setComments] = useState<AuthorComment[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!ownerToken) { setPosts([]); setComments([]); setLoading(false); return }
    setLoading(true)
    try {
      const [p, c] = await Promise.all([
        supabase.from('board_posts')
          .select('id,nickname,title,comment_count,upvotes,downvotes,created_at')
          .eq('owner_token', ownerToken)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('board_comments')
          .select('id,post_id,nickname,content,created_at,board_posts(title)')
          .eq('owner_token', ownerToken)
          .eq('is_active', true)
          // 비밀 댓글은 목록에서 통째로 제외(위 주석 참고)
          .eq('is_secret', false)
          .order('created_at', { ascending: false })
          .limit(200),
      ])
      setPosts((p.data as unknown as AuthorPost[]) ?? [])
      setComments(((c.data ?? []) as unknown as Array<{
        id: string; post_id: string; nickname: string; content: string
        created_at: string; board_posts: { title: string } | null
      }>).map((x) => ({
        id: x.id, post_id: x.post_id, nickname: x.nickname, content: x.content,
        created_at: x.created_at, post_title: x.board_posts?.title ?? null,
      })))
    } finally {
      setLoading(false)
    }
  }, [ownerToken])

  useEffect(() => { load() }, [load])
  return { posts, comments, loading, refetch: load }
}
