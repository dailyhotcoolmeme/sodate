import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

/** PostgREST 가 한 번에 내주는 최대 행 수. 이보다 많으면 나눠 받아야 한다. */
const PAGE = 1000

/**
 * 필터·알림 설정에 쓰는 해시태그 후보.
 *
 * **admin 에 등록된 것만 보여준다**(2026-07-31 오너 확정). 등록처는 두 군데다.
 *   · `company_image_types.hashtags` — 모임 유형별로 지정한 태그
 *   · `events.hashtags` — 일정에 직접 붙인 태그
 *
 * 예전에는 코드에 박아둔 시작 사전(HASHTAG_SEED)을 항상 앞에 세웠는데, 그중 7개는
 * 어디에도 없는 태그였다(#심리팅 #이미지팅 #에세이팅 #외국계 #공무원 #교사 #비흡연).
 * 고르면 알림이 영영 오지 않는다. 그래서 사전은 더 쓰지 않는다.
 *
 * 순서는 많이 쓰인 순 — admin 의 태그 후보(`useAllHashtags`)와 같은 기준이라
 * 양쪽에서 같은 표기가 위에 온다.
 */
export function useHashtags(): string[] {
  const [tags, setTags] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const counts: Record<string, number> = {}
      const add = (rows: { hashtags?: string[] | null }[] | null) => {
        for (const r of rows ?? []) {
          for (const t of r.hashtags ?? []) if (t) counts[t] = (counts[t] ?? 0) + 1
        }
      }

      const { data: types } = await supabase
        .from('company_image_types')
        .select('hashtags')
        .limit(PAGE)
      if (!alive) return
      add(types)

      // 활성·미래 일정은 1000건을 넘는다(2026-07-31 기준 1122건). 한 번에 받으면
      // 나머지에만 있는 태그가 통째로 빠지므로 끝까지 나눠 받는다.
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from('events')
          .select('hashtags')
          .eq('is_active', true)
          .gte('event_date', new Date().toISOString())
          .range(from, from + PAGE - 1)
        if (!alive) return
        add(data)
        if (!data || data.length < PAGE) break
      }

      setTags(
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([t]) => t)
      )
    })()
    return () => {
      alive = false
    }
  }, [])

  return tags
}
