import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { HASHTAG_SEED } from '@/constants/hashtags'

// 필터용 해시태그 후보 목록.
// 시작 사전(HASHTAG_SEED)을 기본으로 보여주고, DB(활성·미래 이벤트)에 실제 존재하는
// 태그를 뒤에 이어 붙인다. 사전에 없는 태그는 건수 많은 순으로 정렬.
export function useHashtags(): string[] {
  const [tags, setTags] = useState<string[]>(HASHTAG_SEED)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('events')
        .select('hashtags')
        .eq('is_active', true)
        .gte('event_date', new Date().toISOString())
      if (!alive || !data) return

      const counts: Record<string, number> = {}
      for (const e of data as { hashtags?: string[] | null }[]) {
        for (const t of e.hashtags ?? []) {
          if (t) counts[t] = (counts[t] ?? 0) + 1
        }
      }

      // 사전에 있는 것 먼저(사전 순서 유지), 그다음 사전에 없는 DB 태그를 건수 많은 순.
      const extras = Object.entries(counts)
        .filter(([t]) => !HASHTAG_SEED.includes(t))
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)

      setTags([...HASHTAG_SEED, ...extras])
    })()
    return () => {
      alive = false
    }
  }, [])

  return tags
}
