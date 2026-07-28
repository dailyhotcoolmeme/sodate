import { useMemo, useState } from 'react'
import { X, Plus, AlertTriangle } from 'lucide-react'
import { keywordsOf } from '../lib/matchImageType'

/**
 * "이 유형이 붙을 모임을 찾는 말" 편집기.
 *
 * 유형 이름을 그대로 검색어로 쓰던 방식은, 이름을 매칭 사정에 맞춰 지어야 하는 문제가 있었다
 * (로꼬: 유형명 '와인파티' vs 실제 제목 '수원 와인 파티' → 띄어쓰기 때문에 안 걸림).
 * 이름은 알아보기 쉽게 두고, 검색어는 실제 제목에 맞춰 여러 개 넣는다.
 *
 * 넣는 즉시 "몇 건이 걸리는지 + 실제 제목"을 보여준다. 앱을 열어보지 않고 확인하려고.
 */
export default function MatchKeywordEditor({
  typeName, keywords, titles, otherTypes, onChange,
}: {
  typeName: string
  keywords: string[]
  /** 이 업체의 모임 제목 전체 */
  titles: string[]
  /** 같은 업체의 다른 유형들 — 어느 쪽이 이기는지 판정용 */
  otherTypes: { name: string; match_keywords?: string[] | null }[]
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')

  // 검색어를 안 넣으면 유형 이름으로 매칭된다(하위호환) — 화면에도 그렇게 보여준다
  const effective = keywords.length ? keywords : [typeName].filter(Boolean)
  const usingName = keywords.length === 0

  const { hits, stolen } = useMemo(() => {
    const hit: string[] = []
    const steal: { title: string; by: string }[] = []
    for (const title of titles) {
      const hay = (title ?? '').toLowerCase()
      const mine = effective
        .filter((k) => hay.includes(k.toLowerCase()))
        .sort((a, b) => b.length - a.length)[0]
      if (!mine) continue
      // 다른 유형이 더 긴 검색어로 걸리면 그쪽이 이긴다
      let winner: { name: string; len: number } | null = null
      for (const o of otherTypes) {
        const k = keywordsOf(o).filter((x) => hay.includes(x.toLowerCase())).sort((a, b) => b.length - a.length)[0]
        if (k && k.length > mine.length && (!winner || k.length > winner.len)) winner = { name: o.name, len: k.length }
      }
      if (winner) steal.push({ title, by: winner.name })
      else hit.push(title)
    }
    return { hits: hit, stolen: steal }
  }, [titles, effective, otherTypes])

  const add = (raw: string) => {
    const k = raw.trim()
    if (!k) return
    if (keywords.some((x) => x.toLowerCase() === k.toLowerCase())) return
    onChange([...keywords, k])
    setInput('')
  }

  return (
    <div className="mb-3 rounded-lg bg-gray-50 border border-gray-200 p-2.5">
      <p className="text-xs font-semibold text-gray-700 mb-2">이 유형이 붙을 모임을 찾는 말</p>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {keywords.map((k) => (
          <span key={k} className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full bg-white border border-gray-300 text-xs text-gray-800">
            {k}
            <button onClick={() => onChange(keywords.filter((x) => x !== k))} className="p-0.5 text-gray-400 hover:text-red-500" aria-label={`${k} 삭제`}>
              <X size={12} />
            </button>
          </span>
        ))}
        {usingName && (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-white border border-dashed border-gray-300 text-xs text-gray-500">
            유형 이름 사용 중: {typeName}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input) } }}
            placeholder="찾을 말 입력"
            className="w-32 px-2 py-1 text-xs border border-gray-300 rounded-full bg-white focus:outline-none focus:border-pink-400"
          />
          <button onClick={() => add(input)} disabled={!input.trim()}
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full bg-gray-900 text-white text-xs disabled:opacity-30">
            <Plus size={11} /> 추가
          </button>
        </span>
      </div>

      <p className={`text-xs font-medium ${hits.length ? 'text-green-700' : 'text-orange-600'}`}>
        {hits.length ? `이 유형이 붙는 모임 ${hits.length}건` : '걸리는 모임이 없습니다'}
      </p>
      {hits.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {hits.slice(0, 3).map((t) => (
            <li key={t} className="text-[11px] text-gray-500 truncate">· {t}</li>
          ))}
          {hits.length > 3 && <li className="text-[11px] text-gray-400">· 외 {hits.length - 3}건</li>}
        </ul>
      )}

      {stolen.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{stolen.length}건은 더 구체적인 말이 걸려 「{stolen[0].by}」 유형으로 갑니다</span>
        </div>
      )}
    </div>
  )
}
