import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * 지금 서비스에 실제로 쓰이고 있는 해시태그 전체.
 *
 * 예전에는 화면마다 자기 범위(열어놓은 업체의 일정, 현재 표에 로드된 행)에서만
 * 후보를 뽑아, 다른 업체에서 이미 #직장인검증 을 쓰고 있는데도 후보에 안 떠서
 * #직장검증 처럼 갈라진 표기가 새로 생겼다. 태그 필터는 표기가 정확히 같아야
 * 묶이므로 그러면 필터가 쪼개진다(2026-07-30 오너 지적).
 *
 * 그래서 업체·화면 범위와 무관하게 전체에서 모은다. 많이 쓰인 표기가 먼저 오도록
 * 사용 건수 내림차순으로 정렬해, 갈라진 표기 중 우세한 쪽을 고르게 유도한다.
 */
export function useAllHashtags(): string[] {
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 태그 컬럼만 받는다(1000여 건이라도 payload가 작다).
      const [ev, ty] = await Promise.all([
        supabase.from('events').select('hashtags').eq('is_active', true).limit(5000),
        supabase.from('company_image_types').select('hashtags').limit(1000),
      ])
      if (!alive) return

      const counts = new Map<string, { tag: string; n: number }>()
      const add = (rows: { hashtags: string[] | null }[] | null) => {
        for (const r of rows ?? []) {
          for (const raw of r.hashtags ?? []) {
            const tag = (raw ?? '').trim()
            if (!tag) continue
            // 대소문자만 다른 건 같은 태그로 세고, 처음 만난 표기를 대표로 쓴다.
            const key = tag.toLowerCase()
            const cur = counts.get(key)
            if (cur) cur.n += 1
            else counts.set(key, { tag, n: 1 })
          }
        }
      }
      add(ev.data as any)
      add(ty.data as any)

      setTags([...counts.values()].sort((a, b) => b.n - a.n).map((x) => x.tag))
    })()
    return () => {
      alive = false
    }
  }, [])

  return tags
}
