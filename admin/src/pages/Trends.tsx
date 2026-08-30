import { useEffect, useState, useMemo } from 'react'

/**
 * 커뮤니티 인기글 모니터(2026-08-31, 오너 지시).
 * "지금 20~30대가 뭘 보고 있나"를 한 화면에 모아 글 소재를 고르는 용도.
 * 데이터는 서버(functions/api/trends.ts)가 각 사이트 공개 인기글 목록에서 모아온다.
 */
interface Metric {
  /** 그 사이트가 쓰는 이름 그대로(조회 / 추천 / 공감 / 댓글 …) */
  label: string
  value: string
}
interface TrendItem {
  source: string
  rank: number
  title: string
  url: string
  /** 목록에 표기된 작성 시각(사이트마다 형식이 달라 문자열 그대로) */
  postedAt?: string
  metrics: Metric[]
}
interface SourceResult {
  source: string
  items: TrendItem[]
  error: string | null
}

const SOURCE_COLOR: Record<string, string> = {
  네이트판: 'bg-rose-100 text-rose-700',
  더쿠: 'bg-violet-100 text-violet-700',
  '디시 실베': 'bg-emerald-100 text-emerald-700',
  루리웹: 'bg-amber-100 text-amber-700',
  엠팍: 'bg-sky-100 text-sky-700',
  오유: 'bg-teal-100 text-teal-700',
  웃긴대학: 'bg-orange-100 text-orange-700',
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
        {/* 폰에서는 칩 아래로 떨어지며 가로를 꽉 채우고, 넓은 화면에서만 오른쪽 끝으로 민다 */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 검색"
          className="w-full sm:w-48 sm:ml-auto px-3 py-1.5 rounded-lg border border-gray-200 text-sm"
        />
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}
      {results.some((r) => r.error) && (
        <p className="text-xs text-amber-600">
          일부 사이트를 못 읽었습니다: {results.filter((r) => r.error).map((r) => `${r.source}(${r.error})`).join(', ')}
        </p>
      )}

      {/* ⚠️ 표(table)로 그렸더니 폰에서 제목 칸이 눌려 한 글자씩 세로로 끊겼다
          (2026-08-31 오너 지적). 목록 한 줄 = 카드 하나로 바꿔서 제목이 가로로 온전히
          들어가게 하고, 출처·조회·댓글은 제목 아래 작은 줄로 내렸다. */}
      {loading && !results.length ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : !merged.length ? (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-gray-400 text-sm">
          표시할 글이 없습니다
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {merged.map((it, i) => (
            <a
              key={`${it.source}-${it.url}-${i}`}
              href={it.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100"
            >
              <span className="text-gray-300 text-xs font-medium tabular-nums pt-0.5 w-5 shrink-0 text-right">
                {it.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-gray-800 text-sm leading-snug break-words">{it.title}</span>
                {/* 지표 이름은 사이트가 쓰는 용어 그대로 보여준다(추천/공감 등 —
                    오너 지시 2026-08-31). 공통 이름으로 바꾸지 않는다. */}
                <span className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-gray-400">
                  <span className={`px-1.5 py-0.5 rounded font-medium ${SOURCE_COLOR[it.source] ?? 'bg-gray-100 text-gray-600'}`}>
                    {it.source}
                  </span>
                  {it.postedAt && <span className="tabular-nums">{it.postedAt}</span>}
                  {it.metrics.map((m) => (
                    <span key={m.label}>
                      {m.label} <span className="tabular-nums text-gray-500">{m.value}</span>
                    </span>
                  ))}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
