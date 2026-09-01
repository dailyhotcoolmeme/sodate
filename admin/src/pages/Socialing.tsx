import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ExternalLink, Loader2, Search, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import HashtagEditor from '../components/HashtagEditor'

/**
 * 소셜링 일정 페이지(메뉴명 '소셜링 일정', 경로 /socialing).
 *
 * 소개팅(/register)과 화면을 나눈 이유 — 관리하는 값이 아예 다르다.
 * 소셜링 1,929건을 실제로 재보니(2026-09-01):
 *   남녀 정원·잔여   1%    ← 소셜링은 성별로 안 가른다
 *   남녀 가격 동일   83%   ← 한 가격
 *   카테고리         100%
 *   해시태그         100%
 *   참가 연령        0%
 * 소개팅 화면의 남/여 6칸(정원·잔여·가격)은 여기선 전부 빈칸이 되고,
 * 정작 필요한 카테고리는 소개팅 화면에 자리가 없다.
 *
 * 소셜링은 플랫폼(문토·트레바리·동행클럽)이 정원·마감을 직접 관리하므로
 * 오너가 값을 채워 넣을 일이 없다. 이 화면은 '검수'가 목적이다 —
 * 잘못 들어온 모임을 앱에서 내리고, 카테고리·해시태그를 손보고, 원본을 확인한다.
 */

type Row = {
  id: string
  title: string
  company_id: string
  company_name: string
  event_date: string
  source_url: string | null
  location_region: string
  socialing_category: string | null
  price_male: number | null
  hashtags: string[]
  is_closed: boolean
  is_active: boolean
}

const PAGE = 1000

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}.${p(d.getDate())}(${dow}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Socialing() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterActive, setFilterActive] = useState<'all' | 'on' | 'off'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const savingRef = useRef<Set<string>>(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const now = new Date()
    const horizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
    const COLS =
      'id, title, company_id, event_date, source_url, location_region, socialing_category, price_male, hashtags, is_closed, is_active, companies(name)'
    let data: any[] = []
    // ⚠️ limit 을 안 걸면 PostgREST 기본 상한(1000행)에 조용히 잘린다.
    //    2개월치 소셜링이 1,900건이라 뒤쪽이 통째로 안 보였다.
    for (let from = 0; ; from += PAGE) {
      const res = await supabase
        .from('events')
        .select(COLS)
        .eq('event_type', 'socialing')
        .gte('event_date', now.toISOString())
        .lte('event_date', horizon.toISOString())
        .order('event_date')
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
    setRows(
      data.map((e: any) => ({
        id: e.id,
        title: e.title ?? '',
        company_id: e.company_id,
        company_name: e.companies?.name ?? '',
        event_date: e.event_date,
        source_url: e.source_url,
        location_region: e.location_region ?? '',
        socialing_category: e.socialing_category,
        price_male: e.price_male,
        hashtags: e.hashtags ?? [],
        is_closed: !!e.is_closed,
        is_active: e.is_active !== false,
      })),
    )
    setLoading(false)
  }

  const companies = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach((r) => { if (r.company_name) m.set(r.company_id, r.company_name) })
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  }, [rows])

  const categories = useMemo(() => {
    const c = new Map<string, number>()
    rows.forEach((r) => { if (r.socialing_category) c.set(r.socialing_category, (c.get(r.socialing_category) ?? 0) + 1) })
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filterCompany && r.company_id !== filterCompany) return false
      if (filterCategory && r.socialing_category !== filterCategory) return false
      if (filterActive === 'on' && !r.is_active) return false
      if (filterActive === 'off' && r.is_active) return false
      if (!q) return true
      return (
        r.title.toLowerCase().includes(q) ||
        r.location_region.toLowerCase().includes(q) ||
        r.hashtags.some((h) => h.toLowerCase().includes(q))
      )
    })
  }, [rows, search, filterCompany, filterCategory, filterActive])

  async function patch(id: string, patchValues: Partial<Row>, dbValues: Record<string, unknown>) {
    if (savingRef.current.has(id)) return
    savingRef.current.add(id)
    setSavingIds(new Set(savingRef.current))
    const before = rows.find((r) => r.id === id)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patchValues } : r)))
    const { error } = await supabase.from('events').update(dbValues).eq('id', id)
    savingRef.current.delete(id)
    setSavingIds(new Set(savingRef.current))
    if (error) {
      setMsg(`저장 실패: ${error.message}`)
      // 실패했는데 화면만 바뀌어 있으면 저장된 줄 안다 — 되돌린다.
      if (before) setRows((rs) => rs.map((r) => (r.id === id ? before : r)))
      return
    }
    setMsg(null)
  }

  async function remove(r: Row) {
    if (!confirm(`이 모임을 삭제할까요?\n\n${r.title}\n\n크롤링이 다시 가져올 수 있습니다. 그냥 감추려면 '앱 노출'을 끄세요.`)) return
    const { error } = await supabase.from('events').delete().eq('id', r.id)
    if (error) { setMsg(`삭제 실패: ${error.message}`); return }
    setRows((rs) => rs.filter((x) => x.id !== r.id))
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="p-4 md:p-8 max-w-[1500px] min-w-0">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">소셜링 일정</h1>
        <p className="text-sm text-gray-500 mt-1">
          취미·모임 플랫폼에서 모은 일정입니다. 정원·마감은 각 플랫폼이 관리하므로 여기선 손대지 않습니다.
          <b> 잘못 들어온 모임을 앱에서 내리고</b>, 카테고리·해시태그를 정리하는 화면입니다.
        </p>
      </div>

      {msg && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          <span className="flex-1">{msg}</span>
          <button onClick={() => setMsg(null)} className="text-red-400"><X size={14} /></button>
        </div>
      )}

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목·지역·해시태그 검색"
            className="w-56 min-w-0 rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">전체 업체</option>
          {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">전체 카테고리</option>
          {categories.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
        </select>
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm">
          {([['all', '전체'], ['on', '노출'], ['off', '숨김']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setFilterActive(v)}
              className={`whitespace-nowrap px-3 py-2 ${filterActive === v ? 'bg-pink-500 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">
          {loading ? '불러오는 중...' : `${filtered.length.toLocaleString()}건 / 전체 ${rows.length.toLocaleString()}건`}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">일시</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">업체</th>
                <th className="px-3 py-3 text-left font-medium">제목</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">지역</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">카테고리</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">가격</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">마감</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">앱 노출</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">원본</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap">태그</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <>
                  <tr key={r.id} className={`border-t border-gray-100 ${r.is_active ? '' : 'bg-gray-50 text-gray-400'}`}>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(r.event_date)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{r.company_name}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[380px] truncate" title={r.title}>{r.title}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{r.location_region}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.socialing_category
                        ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700">{r.socialing_category}</span>
                        : <span className="text-xs text-gray-300">없음</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-gray-600">
                      {r.price_male == null ? <span className="text-gray-300">-</span> : `${r.price_male.toLocaleString()}원`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.is_closed
                        ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">마감</span>
                        : <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">모집중</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={r.is_active}
                          onChange={(e) => patch(r.id, { is_active: e.target.checked }, { is_active: e.target.checked })}
                          className="w-4 h-4 accent-pink-500"
                        />
                        {savingIds.has(r.id) && <Loader2 size={12} className="animate-spin text-gray-400" />}
                      </label>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {r.source_url
                        ? <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex text-gray-400 hover:text-pink-500"><ExternalLink size={15} /></a>
                        : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => toggleExpand(r.id)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                        {r.hashtags.length}
                        {expanded.has(r.id) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </td>
                  </tr>
                  {expanded.has(r.id) && (
                    <tr key={`${r.id}-x`} className="border-t border-gray-100 bg-gray-50/60">
                      <td colSpan={10} className="px-3 py-3">
                        <div className="flex flex-wrap items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="mb-1.5 text-xs font-medium text-gray-500">해시태그</p>
                            <HashtagEditor
                              value={r.hashtags}
                              onChange={(tags) => patch(r.id, { hashtags: tags }, { hashtags: tags })}
                            />
                          </div>
                          <button
                            onClick={() => remove(r)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={13} /> 삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-gray-400">해당하는 소셜링 일정이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
