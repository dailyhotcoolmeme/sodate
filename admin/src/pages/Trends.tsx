import { useEffect, useState, useMemo } from 'react'

/**
 * 커뮤니티 인기글 모니터(2026-08-31, 오너 지시).
 * "지금 20~30대가 뭘 보고 있나"를 한 화면에 모아 글 소재를 고르는 용도.
 * 데이터는 서버(functions/api/trends.ts)가 각 사이트 공개 인기글 목록에서 모아온다.
 */
interface TrendItem {
  source: string
  rank: number
  title: string
  url: string
  views?: number
  comments?: number
}
interface SourceResult {
  source: string
  items: TrendItem[]
  error: string | null
}

const SOURCE_COLOR: Record<string, string> = {
  네이트판: 'bg-rose-100 text-rose-700',
  더쿠: 'bg-violet-100 text-violet-700',
  클리앙: 'bg-sky-100 text-sky-700',
}

export default function Trends() {
  const [results, setResults] = useState<SourceResult[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('전체')
  const [q, setQ] = useState('')

  const load = () => {
    setLoading(true)
    setErr(null)
    fetch('/api/trends', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? '로그인이 필요합니다' : `요청 실패 (${r.status})`)
        return r.json()
      })
      .then((d) => {
        setResults(d.results ?? [])
        setFetchedAt(d.fetchedAt ?? null)
      })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const sources = useMemo(() => ['전체', ...results.map((r) => r.source)], [results])

  // 소스별 순위를 번갈아 섞어 한 곳이 위를 독점하지 않게 한다(전체 보기일 때).
  const merged = useMemo(() => {
    const lists = results
      .filter((r) => filter === '전체' || r.source === filter)
      .map((r) => r.items)
    const out: TrendItem[] = []
    for (let i = 0; i < 40; i++) {
      for (const l of lists) if (l[i]) out.push(l[i])
    }
    const needle = q.trim()
    return needle ? out.filter((i) => i.title.includes(needle)) : out
  }, [results, filter, q])

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">커뮤니티 인기글</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            글 소재 참고용 · 지금 각 커뮤니티에서 반응 많은 글
            {fetchedAt && ` · ${new Date(fetchedAt).toLocaleTimeString('ko-KR')} 기준`}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? '불러오는 중...' : '새로고침'}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {sources.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              filter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 검색"
          className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 text-sm w-48"
        />
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {results.some((r) => r.error) && (
        <p className="text-xs text-amber-600">
          일부 사이트를 못 읽었습니다: {results.filter((r) => r.error).map((r) => `${r.source}(${r.error})`).join(', ')}
        </p>
      )}

      {loading && !results.length ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium w-24">출처</th>
                <th className="px-4 py-3 text-center font-medium w-12">순위</th>
                <th className="px-4 py-3 text-left font-medium">제목</th>
                <th className="px-4 py-3 text-right font-medium w-24">조회</th>
                <th className="px-4 py-3 text-right font-medium w-20">댓글</th>
              </tr>
            </thead>
            <tbody>
              {merged.map((it, i) => (
                <tr key={`${it.source}-${it.url}-${i}`} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_COLOR[it.source] ?? 'bg-gray-100 text-gray-600'}`}>
                      {it.source}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-400 text-xs">{it.rank}</td>
                  <td className="px-4 py-2.5">
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gray-800 hover:text-blue-600 hover:underline"
                    >
                      {it.title}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500 text-xs">
                    {it.views != null ? it.views.toLocaleString() : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500 text-xs">
                    {it.comments != null ? it.comments.toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
              {!merged.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                    표시할 글이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
