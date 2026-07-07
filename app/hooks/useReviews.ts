import { useState, useEffect, useCallback } from 'react'
import { supabase, type ReviewRow } from '@/lib/supabase'

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
      .order('published_at', { ascending: false })
      .limit(limit)
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setReviews((data ?? []) as ReviewRow[])
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
      .order('published_at', { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        setReviews((data ?? []) as any)
        setLoading(false)
      })
  }, [limit])

  useEffect(() => {
    load()
  }, [load])

  return { reviews, loading, refetch: load }
}
