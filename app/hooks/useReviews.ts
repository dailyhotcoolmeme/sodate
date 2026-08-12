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

/**
 * 후기 모아보기 — 전체를 나눠 받는다.
 *
 * ⚠️ 예전에는 `.limit(500)` 하나로 끝냈는데, 조건에 맞는 후기가 702건(2026-08-13 실측)이라
 *    202건이 조용히 잘렸다. 게다가 published_at DESC 는 PostgreSQL 기본이 NULLS FIRST 라
 *    published_at 이 없는 인스타 후기가 앞을 다 차지하고, 날짜가 있는 블로그·유튜브 후기가
 *    남은 자리만 나눠 가져 오래된 후기는 화면에서 도달할 방법이 없었다. 탭 배지 개수도
 *    잘린 목록으로 세어 실제와 달랐다.
 */
export function useAllReviews() {
  const [reviews, setReviews] = useState<(ReviewRow & { companies: { name: string; slug: string } | null })[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    const PAGE = 1000
    ;(async () => {
      try {
        const rows: any[] = []
        for (let from = 0; ; from += PAGE) {
          const { data } = await supabase
            .from('reviews')
            .select('*, companies(name, slug)')
            .eq('is_active', true)
            .or(KEEP_WITHOUT_DATE)
            .order('published_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .range(from, from + PAGE - 1)
          if (data) rows.push(...data)
          if (!data || data.length < PAGE) break
        }
        setReviews(rows as any)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { reviews, loading, refetch: load }
}
