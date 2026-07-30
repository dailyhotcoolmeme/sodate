import { useState, useEffect, useCallback } from 'react'
import { supabase, type ReviewRow } from '@/lib/supabase'

// 게시일 없는 크롤링 후기는 목록에 올리지 않는다(오너 확정).
// 블로그·유튜브는 크롤러가 게시일 없는 건을 아예 저장하지 않지만, 과거에 들어온
// 잔재까지 걸러내려면 조회에서도 막아야 한다. 인스타그램은 로그인 없이 게시일을
// 얻을 수 없어 예외로 두고 '게시일 확인 불가'로 표기한다(사용자 작성 후기도 예외).
const KEEP_WITHOUT_DATE = 'source.in.(instagram,user),published_at.not.is.null'

export function useReviews(companyId: string | null, limit = 10) {
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReviews = useCallback(() => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('reviews')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .or(KEEP_WITHOUT_DATE)
      .order('published_at', { ascending: false })
      .limit(limit)
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setReviews((data ?? []) as ReviewRow[])
        setLoading(false)
      }, (e: any) => {
        // fetch 자체 실패(네트워크·타임아웃)로 스피너가 안 멈추던 것 방지
        setError(e?.message ?? '후기를 불러오지 못했어요')
        setLoading(false)
      })
  }, [companyId, limit])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  return { reviews, loading, error, refetch: fetchReviews }
}

export function useAllReviews(limit = 500) {
  const [reviews, setReviews] = useState<(ReviewRow & { companies: { name: string; slug: string } | null })[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    supabase
      .from('reviews')
      .select('*, companies(name, slug)')
      .eq('is_active', true)
      .or(KEEP_WITHOUT_DATE)
      .order('published_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        setReviews((data ?? []) as any)
        setLoading(false)
      }, () => setLoading(false))
  }, [limit])

  useEffect(() => {
    load()
  }, [load])

  return { reviews, loading, refetch: load }
}
