import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getMyPostIds, getMyCommentIds, getMyVotes, getBlockedAuthors } from '@/lib/boardIdentity'
import type { BoardPost, BoardComment, BoardSettings } from '@/lib/board'

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
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    const from = page * PAGE_SIZE
    let q = supabase
      .from('board_posts')
      .select(
        'id,nickname,title,content,image_urls,upvotes,downvotes,comment_count,image_hidden,owner_token,created_at',
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
        const rows = (data as unknown as BoardPost[]) ?? []
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
  const [post, setPost] = useState<BoardPost | null>(null)
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
          .select('id,nickname,title,content,image_urls,upvotes,downvotes,comment_count,image_hidden,owner_token,is_active,created_at,updated_at')
          .eq('id', id).maybeSingle(),
        supabase.from('board_comments')
          .select('id,post_id,parent_id,nickname,content,owner_token,created_at,updated_at')
          .eq('post_id', id).eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])
      const blocked = await getBlockedAuthors()
      const blockedKeys = new Set(blocked.map((b) => b.key))
      const postRow = (p as unknown as BoardPost) ?? null
      setPost(postRow)
      setPostBlocked(!!postRow && blockedKeys.has(postRow.owner_token))
      const commentRows = (c as unknown as BoardComment[]) ?? []
      setComments(blockedKeys.size ? commentRows.filter((cm) => !blockedKeys.has(cm.owner_token)) : commentRows)

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
        .select('id,post_id,content,is_active,created_at,board_posts(title)')
        .in('id', ids)
        .order('created_at', { ascending: false })
      const mapped = ((data ?? []) as unknown as Array<{
        id: string; post_id: string; content: string; is_active: boolean; created_at: string
        board_posts: { title: string } | null
      }>).map((c) => ({
        id: c.id, post_id: c.post_id, content: c.content, is_active: c.is_active, created_at: c.created_at,
        post_title: c.board_posts?.title ?? null,
      }))
      setComments(mapped)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { comments, loading, refetch: load }
}
