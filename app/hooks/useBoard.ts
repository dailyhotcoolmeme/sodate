import { useState, useEffect, useCallback } from 'react'
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

  const load = useCallback(() => {
    setLoading(true)
    const from = page * PAGE_SIZE
    let q = supabase
      .from('board_posts')
      .select(
        'id,nickname,title,content,image_urls,link_urls,tag_id,board_tags(label),upvotes,downvotes,comment_count,content_hidden,owner_token,created_at',
        { count: 'exact' }
      )
      .eq('is_active', true)

    const term = search.trim()
    if (term) {
      // 제목 + 본문. 쉼표·괄호는 or 구문의 구분자라 검색어에 들어가면 질의가 깨진다.
      const safe = term.replace(/[,()]/g, ' ')
      q = q.or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
    }

    q.order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
      .then(async ({ data, count }) => {
        const blocked = await getBlockedAuthors()
        const blockedKeys = new Set(blocked.map((b) => b.key))
        const rows = (data as unknown as BoardPostWithTag[]) ?? []
        setPosts(blockedKeys.size ? rows.filter((p) => !blockedKeys.has(p.owner_token)) : rows)
        setTotal(count ?? 0)
        setLoading(false)
      }, () => setLoading(false))
  }, [page, search])

  useEffect(() => { load() }, [load])

  return {
    posts, total, loading, refetch: load,
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

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('board_posts')
          .select('id,nickname,title,content,image_urls,link_urls,tag_id,board_tags(label),upvotes,downvotes,comment_count,content_hidden,owner_token,is_active,created_at,updated_at')
          .eq('id', id).maybeSingle(),
        supabase.from('board_comments')
          .select('id,post_id,parent_id,nickname,content,owner_token,is_secret,created_at,updated_at')
          .eq('post_id', id).eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])
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

  return { post, postBlocked, comments, myVote, isMine, myCommentIds, loading, refetch: load, setMyVote }
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
