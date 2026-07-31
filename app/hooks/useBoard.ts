import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getMyPostIds, getMyCommentIds, getMyVotes } from '@/lib/boardIdentity'
import type { BoardPost, BoardComment, BoardSettings } from '@/lib/board'

/**
 * 게시판 조회. 쓰기는 Edge Function(lib/board.ts), 읽기는 RLS로 직접 한다.
 *
 * 목록은 번호 페이지 방식이다(오너 확정). 무한 스크롤이 아니라서 range 로 잘라 읽고
 * 전체 건수를 함께 받아 페이지 수를 계산한다.
 *
 * '내 것' 판단은 기기에 저장한 id 목록으로 한다(lib/boardIdentity.ts).
 * owner_token 은 익명성 때문에 앱에 내려주지 않는다.
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
        'id,nickname,title,content,image_urls,upvotes,downvotes,comment_count,image_hidden,created_at',
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
      .then(({ data, count }) => {
        setPosts((data as unknown as BoardPost[]) ?? [])
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
          .select('id,nickname,title,content,image_urls,upvotes,downvotes,comment_count,image_hidden,is_active,created_at,updated_at')
          .eq('id', id).maybeSingle(),
        supabase.from('board_comments')
          .select('id,post_id,parent_id,nickname,content,created_at,updated_at')
          .eq('post_id', id).eq('is_active', true)
          .order('created_at', { ascending: true }),
      ])
      setPost((p as unknown as BoardPost) ?? null)
      setComments((c as unknown as BoardComment[]) ?? [])

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

  return { post, comments, myVote, isMine, myCommentIds, loading, refetch: load, setMyVote }
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
