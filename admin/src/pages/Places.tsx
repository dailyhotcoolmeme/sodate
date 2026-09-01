import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ExternalLink, Loader2, Search, X, ChevronDown, ChevronUp, Instagram, Star } from 'lucide-react'

/**
 * 혼술바 관리 페이지(메뉴명 '혼술바', 경로 /places).
 *
 * 지금까지 places 테이블(500곳)을 손대려면 DB를 직접 건드리는 수밖에 없었다.
 * 앱에는 1.1.0으로 정식 출시됐는데 잘못된 매장 하나 못 내리는 상태였다.
 *
 * 편집 가능(오너가 정답):
 *   앱 노출 / 상호 / 지역 / 도로명 주소 / 전화 / 인스타그램 / 심야 / 폐업일
 * 읽기 전용(크롤 정본 — 여기서 고쳐봐야 다음 크롤에 덮어쓴다):
 *   영업시간 · 평점 · 리뷰수 · 편의시설 · 방문자 키워드 · 썸네일
 *
 * ⚠️ honsul_badges / mood_tags 는 편집칸을 두지 않았다. 컬럼은 있지만 채우는
 *    크롤러도 없고(500곳 전부 빈 배열) 앱에서 그리는 곳도 없다. 쓰기 시작할 때
 *    같이 만든다 — 지금 만들면 아무 데도 안 보이는 값을 입력하게 된다.
 */

type Place = {
  id: string
  name: string
  category: string | null
  uptae: string | null
  biz_status: string | null
  region: string | null
  address_road: string | null
  tel: string | null
  instagram: string | null
  naver_place_id: string | null
  naver_url: string | null
  hours: Record<string, string> | null
  late_night: boolean
  conveniences: string[] | null
  naver_rating: number | null
  naver_review_count: number | null
  keyword_votes: Record<string, number> | null
  thumbnail_url: string | null
  is_active: boolean
  closed_at: string | null
  updated_at: string | null
}

const PAGE = 1000
const DOW = ['월', '화', '수', '목', '금', '토', '일']

export default function Places() {
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterRegion, setFilterRegion] = useState('')
  const [filterActive, setFilterActive] = useState<'all' | 'on' | 'off'>('all')
  const [filterFlaw, setFilterFlaw] = useState(false)   // 빠진 정보만 보기
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const savingRef = useRef<Set<string>>(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    let data: any[] = []
    for (let from = 0; ; from += PAGE) {
      const res = await supabase
        .from('places')
        .select('id,name,category,uptae,biz_status,region,address_road,tel,instagram,naver_place_id,naver_url,hours,late_night,conveniences,naver_rating,naver_review_count,keyword_votes,thumbnail_url,is_active,closed_at,updated_at')
        .eq('service', 'honsul')
        .order('region')
        .order('name')
        .range(from, from + PAGE - 1)
      if (res.error) {
        const detail = (res.error as any)?.message || (res.error as any)?.error || JSON.stringify(res.error)
        const unauth = String(detail).includes('unauthorized') || (res.error as any)?.code === '401'
        setMsg(unauth ? '로그인이 필요합니다. 다시 로그인해 주세요.' : `로딩 오류: ${detail}`)
        setLoading(false)
        return
      }
      data = data.concat(res.data ?? [])
      if ((res.data?.length ?? 0) < PAGE) break
    }
    setPlaces(data as Place[])
    setLoading(false)
  }

  const regions = useMemo(() => {
    const c = new Map<string, number>()
    places.forEach((p) => { if (p.region) c.set(p.region, (c.get(p.region) ?? 0) + 1) })
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  }, [places])

  function flaws(p: Place): string[] {
    const f: string[] = []
    if (!p.hours || Object.keys(p.hours).length === 0) f.push('영업시간')
    if (p.naver_rating == null) f.push('평점')
    if (!p.thumbnail_url) f.push('대표사진')
    if (!p.tel) f.push('전화')
    return f
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return places.filter((p) => {
      if (filterRegion && p.region !== filterRegion) return false
      if (filterActive === 'on' && !p.is_active) return false
      if (filterActive === 'off' && p.is_active) return false
      if (filterFlaw && flaws(p).length === 0) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.region ?? '').toLowerCase().includes(q) ||
        (p.address_road ?? '').toLowerCase().includes(q)
      )
    })
  }, [places, search, filterRegion, filterActive, filterFlaw])

  async function patch(id: string, values: Partial<Place>) {
    if (savingRef.current.has(id)) return
    savingRef.current.add(id)
    setSavingIds(new Set(savingRef.current))
    const before = places.find((p) => p.id === id)
    setPlaces((ps) => ps.map((p) => (p.id === id ? { ...p, ...values } : p)))
    const { error } = await supabase.from('places').update(values).eq('id', id)
    savingRef.current.delete(id)
    setSavingIds(new Set(savingRef.current))
    if (error) {
      setMsg(`저장 실패: ${error.message}`)
      if (before) setPlaces((ps) => ps.map((p) => (p.id === id ? before : p)))
      return
    }
    setMsg(null)
  }

  async function markClosed(p: Place) {
    if (!confirm(`'${p.name}' 을(를) 폐업 처리할까요?\n\n앱에서 즉시 내려가고 폐업일이 오늘로 기록됩니다.`)) return
    const today = new Date().toISOString().slice(0, 10)
    await patch(p.id, { closed_at: today, is_active: false })
  }

  async function undoClosed(p: Place) {
    await patch(p.id, { closed_at: null, is_active: true })
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const hidden = places.filter((p) => !p.is_active).length
  const flawed = places.filter((p) => flaws(p).length > 0).length

  return (
    <div className="p-4 md:p-8 max-w-[1500px] min-w-0">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">혼술바</h1>
        <p className="text-sm text-gray-500 mt-1">
          혼자 마시기 좋은 술집 목록입니다. <b>상호·지역·주소·전화·인스타·심야 여부</b>는 여기서 고칩니다.
          영업시간·평점·편의시설은 크롤링이 정본이라 읽기 전용입니다.
        </p>
      </div>

      {msg && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <span className="flex-1">{msg}</span>
          <button onClick={() => setMsg(null)} className="text-red-400"><X size={14} /></button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상호·지역·주소 검색"
            className="w-56 min-w-0 rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <select
          value={filterRegion}
          onChange={(e) => setFilterRegion(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">전체 지역</option>
          {regions.map(([r, n]) => <option key={r} value={r}>{r} ({n})</option>)}
        </select>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm">
          {([['all', '전체'], ['on', '노출'], ['off', `숨김 ${hidden}`]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setFilterActive(v as any)}
              className={`whitespace-nowrap px-3 py-2 ${filterActive === v ? 'bg-pink-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFilterFlaw((v) => !v)}
          className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${filterFlaw ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          빠진 정보만 {flawed}
        </button>
        <span className="text-sm text-gray-400">
          {loading ? '불러오는 중...' : `${filtered.length.toLocaleString()}곳 / 전체 ${places.length.toLocaleString()}곳`}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium w-12"></th>
                <th className="px-3 py-3 text-left font-medium">상호</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">지역</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">업태</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">평점</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">심야</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">빠진 정보</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">앱 노출</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">링크</th>
                <th className="px-3 py-3 text-center font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const f = flaws(p)
                return (
                  <>
                    <tr key={p.id} className={`border-t border-gray-100 ${p.is_active ? '' : 'bg-gray-50 text-gray-400'}`}>
                      <td className="px-3 py-2">
                        {p.thumbnail_url
                          ? <img src={p.thumbnail_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-100" />
                          : <div className="w-9 h-9 rounded-lg bg-gray-100" />}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">
                        {p.name}
                        {p.closed_at && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">폐업 {p.closed_at}</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{p.region ?? '-'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-500 max-w-[160px] truncate" title={p.uptae ?? ''}>{p.uptae ?? '-'}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {p.naver_rating == null
                          ? <span className="text-gray-300">-</span>
                          : (
                            <span className="inline-flex items-center gap-1 text-gray-700">
                              <Star size={12} className="text-amber-400 fill-amber-400" />
                              {p.naver_rating.toFixed(2)}
                              <span className="text-xs text-gray-400">({p.naver_review_count ?? 0})</span>
                            </span>
                          )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={p.late_night}
                          onChange={(e) => patch(p.id, { late_night: e.target.checked })}
                          className="w-4 h-4 accent-pink-500"
                        />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {f.length === 0
                          ? <span className="text-xs text-gray-300">없음</span>
                          : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{f.join('·')}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={p.is_active}
                            onChange={(e) => patch(p.id, { is_active: e.target.checked })}
                            className="w-4 h-4 accent-pink-500"
                          />
                          {savingIds.has(p.id) && <Loader2 size={12} className="animate-spin text-gray-400" />}
                        </label>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-2">
                          {p.naver_url || p.naver_place_id ? (
                            <a
                              href={p.naver_url ?? `https://map.naver.com/p/entry/place/${p.naver_place_id}`}
                              target="_blank" rel="noreferrer"
                              title="네이버 플레이스"
                              className="text-gray-400 hover:text-green-600"
                            ><ExternalLink size={15} /></a>
                          ) : <span className="text-xs text-gray-300">-</span>}
                          {p.instagram && (
                            <a href={p.instagram} target="_blank" rel="noreferrer" title="인스타그램" className="text-gray-400 hover:text-pink-500">
                              <Instagram size={15} />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleExpand(p.id)} className="text-gray-400 hover:text-gray-700">
                          {expanded.has(p.id) ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </td>
                    </tr>

                    {expanded.has(p.id) && (
                      <tr key={`${p.id}-x`} className="border-t border-gray-100 bg-gray-50/60">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="grid gap-5 md:grid-cols-2">
                            {/* 수정 가능 */}
                            <div className="space-y-3">
                              <p className="text-xs font-medium text-gray-500">수정 (여기 값이 정답)</p>
                              <Field label="상호" value={p.name} onSave={(v) => v.trim() && patch(p.id, { name: v.trim() })} />
                              <Field label="지역" value={p.region ?? ''} onSave={(v) => patch(p.id, { region: v.trim() || null })} />
                              <Field label="도로명 주소" value={p.address_road ?? ''} onSave={(v) => patch(p.id, { address_road: v.trim() || null })} />
                              <Field label="전화" value={p.tel ?? ''} onSave={(v) => patch(p.id, { tel: v.trim() || null })} />
                              <Field label="인스타그램" value={p.instagram ?? ''} onSave={(v) => patch(p.id, { instagram: v.trim() || null })} />
                              <div className="pt-1">
                                {p.closed_at ? (
                                  <button onClick={() => undoClosed(p)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-white">
                                    폐업 취소 (앱에 다시 노출)
                                  </button>
                                ) : (
                                  <button onClick={() => markClosed(p)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                                    폐업 처리
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 읽기 전용 */}
                            <div className="space-y-3 text-sm">
                              <p className="text-xs font-medium text-gray-500">크롤링 정본 (읽기 전용)</p>
                              <div>
                                <p className="mb-1 text-xs text-gray-400">영업시간</p>
                                {p.hours && Object.keys(p.hours).length > 0 ? (
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                                    {DOW.filter((d) => p.hours?.[d]).map((d) => (
                                      <span key={d}><b className="text-gray-500">{d}</b> {p.hours![d]}</span>
                                    ))}
                                  </div>
                                ) : <p className="text-xs text-amber-600">없음</p>}
                              </div>
                              <div>
                                <p className="mb-1 text-xs text-gray-400">편의시설</p>
                                <div className="flex flex-wrap gap-1">
                                  {(p.conveniences ?? []).length === 0 && <span className="text-xs text-gray-300">없음</span>}
                                  {(p.conveniences ?? []).map((c) => (
                                    <span key={c} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-600">{c}</span>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs text-gray-400">방문자 키워드</p>
                                <div className="flex flex-wrap gap-1">
                                  {!p.keyword_votes || Object.keys(p.keyword_votes).length === 0
                                    ? <span className="text-xs text-gray-300">없음</span>
                                    : Object.entries(p.keyword_votes)
                                        .sort((a, b) => b[1] - a[1]).slice(0, 10)
                                        .map(([k, v]) => (
                                          <span key={k} className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                            {k} <span className="text-gray-400">{v}</span>
                                          </span>
                                        ))}
                                </div>
                              </div>
                              <p className="text-xs text-gray-400">
                                업종 {p.category ?? '-'} · 영업상태 {p.biz_status ?? '-'}
                                {p.updated_at && ` · 최근 갱신 ${p.updated_at.slice(0, 10)}`}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-400">해당하는 매장이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** 벗어나면(blur) 저장되는 입력칸 — 일정 관리와 같은 방식. */
function Field({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-gray-400">{label}</span>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v !== value) onSave(v) }}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm"
      />
    </label>
  )
}
