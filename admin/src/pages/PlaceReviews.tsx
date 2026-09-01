import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Star, Flag, ExternalLink, Trash2, Eye, EyeOff } from 'lucide-react'

/**
 * 혼술바 후기 관리 페이지(메뉴명 '혼술바 후기', 경로 /place-reviews).
 *
 * 소개팅 후기(reviews 테이블, /reviews)와 매장 후기(place_reviews)는 테이블이 다르다.
 * 앱은 이미 매장 후기 작성·신고를 지원하는데(lib/placeReviews.ts,
 * report_place_review RPC) 어드민에는 볼 화면조차 없었다 — 신고를 받아도
 * 내릴 방법이 없는 상태로 1.1.0이 출시됐다(2026-09-01 점검에서 발견).
 *
 * 우리 이용약관과 앱스토어 심사 답변에 "신고 접수 후 24시간 이내 조치"라고
 * 적어놨다. 이 화면이 그 약속을 지키는 수단이다.
 *
 * ⚠️ place_reviews 에는 신고 사유를 남기는 별도 테이블이 없다(report_count 만 는다).
 *    소개팅 후기의 review_reports 같은 사유 목록은 여기서 보여줄 수 없다.
 */

type PlaceReview = {
  id: string
  place_id: string
  source: string
  author_name: string | null
  content: string | null
  rating: number | null
  report_count: number | null
  is_active: boolean
  owner_token: string | null
  source_url: string | null
  published_at: string | null
  created_at: string | null
  places: { name: string; region: string | null } | null
}

type Tab = 'reported' | 'user' | 'hidden' | 'naver_blog' | 'youtube' | 'instagram'

const SOURCE_LABEL: Record<string, string> = {
  user: '앱 이용자',
  naver_blog: '네이버 블로그',
  youtube: '유튜브',
  instagram: '인스타그램',
}

const PAGE = 1000

export default function PlaceReviews() {
  const [rows, setRows] = useState<PlaceReview[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('reported')   // 신고부터 본다 — 24시간 약속이 걸려 있다

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    let data: any[] = []
    for (let from = 0; ; from += PAGE) {
      const res = await supabase
        .from('place_reviews')
        .select('id, place_id, source, author_name, content, rating, report_count, is_active, owner_token, source_url, published_at, created_at, places(name, region)')
        .order('report_count', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
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
    setRows(data as PlaceReview[])
    setLoading(false)
  }

  async function toggleActive(r: PlaceReview) {
    const next = !r.is_active
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: next } : x)))
    const { error } = await supabase.from('place_reviews').update({ is_active: next }).eq('id', r.id)
    if (error) {
      setMsg(`저장 실패: ${error.message}`)
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, is_active: r.is_active } : x)))
    }
  }

  async function clearReports(r: PlaceReview) {
    setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, report_count: 0 } : x)))
    const { error } = await supabase.from('place_reviews').update({ report_count: 0 }).eq('id', r.id)
    if (error) {
      setMsg(`저장 실패: ${error.message}`)
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, report_count: r.report_count } : x)))
    }
  }

  async function remove(r: PlaceReview) {
    if (!confirm('이 후기를 완전히 삭제할까요? 되돌릴 수 없습니다.\n\n그냥 안 보이게만 하려면 [숨기기]를 쓰세요.')) return
    const { error } = await supabase.from('place_reviews').delete().eq('id', r.id)
    if (error) { setMsg(`삭제 실패: ${error.message}`); return }
    setRows((rs) => rs.filter((x) => x.id !== r.id))
  }

  const counts = useMemo(() => ({
    reported: rows.filter((r) => (r.report_count ?? 0) > 0).length,
    user: rows.filter((r) => r.source === 'user' || r.owner_token).length,
    hidden: rows.filter((r) => !r.is_active).length,
    naver_blog: rows.filter((r) => r.source === 'naver_blog').length,
    youtube: rows.filter((r) => r.source === 'youtube').length,
    instagram: rows.filter((r) => r.source === 'instagram').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'reported' && !((r.report_count ?? 0) > 0)) return false
      if (tab === 'user' && !(r.source === 'user' || r.owner_token)) return false
      if (tab === 'hidden' && r.is_active) return false
      if (tab === 'naver_blog' && r.source !== 'naver_blog') return false
      if (tab === 'youtube' && r.source !== 'youtube') return false
      if (tab === 'instagram' && r.source !== 'instagram') return false
      if (!q) return true
      const hay = `${r.places?.name ?? ''} ${r.author_name ?? ''} ${r.content ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [rows, tab, search])

  const TABS: [Tab, string, number][] = [
    ['reported', '신고됨', counts.reported],
    ['user', '앱 이용자', counts.user],
    ['hidden', '숨김', counts.hidden],
    ['naver_blog', '네이버 블로그', counts.naver_blog],
    ['youtube', '유튜브', counts.youtube],
    ['instagram', '인스타그램', counts.instagram],
  ]

  return (
    <div className="p-4 md:p-8 max-w-[1500px] min-w-0">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">혼술바 후기</h1>
        <p className="text-sm text-gray-500 mt-1">
          매장에 달린 후기입니다. <b>신고된 후기는 접수 후 24시간 이내에 조치</b>한다고 이용약관에 명시돼 있습니다.
          블로그·유튜브 후기는 크롤링해 온 것이라 문제가 있으면 숨기거나 삭제하세요.
        </p>
      </div>

      {msg && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{msg}</div>
      )}

      {counts.reported > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          <Flag size={15} />
          신고된 후기 {counts.reported}건이 처리를 기다리고 있습니다.
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(([t, label, n]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {label} {n}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="매장·작성자·내용 검색"
            className="w-60 min-w-0 rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">
          {tab === 'reported' ? '신고된 후기가 없습니다.' : '해당하는 후기가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <div
              key={r.id}
              className={`rounded-xl border bg-white px-4 py-3 ${(r.report_count ?? 0) > 0 ? 'border-amber-300' : 'border-gray-200'} ${r.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-medium text-gray-800">{r.places?.name ?? '(매장 없음)'}</span>
                {r.places?.region && <span className="text-gray-400">{r.places.region}</span>}
                <span className="rounded-full bg-gray-100 px-2 py-0.5">{SOURCE_LABEL[r.source] ?? r.source}</span>
                {r.rating != null && (
                  <span className="inline-flex items-center gap-1 text-gray-600">
                    <Star size={11} className="text-amber-400 fill-amber-400" />{r.rating}
                  </span>
                )}
                {(r.report_count ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                    <Flag size={10} /> 신고 {r.report_count}
                  </span>
                )}
                {!r.is_active && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600">숨김</span>}
                <span className="ml-auto text-gray-400">
                  {(r.published_at ?? r.created_at ?? '').slice(0, 10)}
                  {r.author_name ? ` · ${r.author_name}` : ''}
                </span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{r.content || <span className="text-gray-300">(내용 없음)</span>}</p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => toggleActive(r)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  {r.is_active ? <><EyeOff size={13} /> 숨기기</> : <><Eye size={13} /> 다시 노출</>}
                </button>
                {(r.report_count ?? 0) > 0 && (
                  <button
                    onClick={() => clearReports(r)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    신고 해제 (문제 없음)
                  </button>
                )}
                <button
                  onClick={() => remove(r)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={13} /> 삭제
                </button>
                {r.source_url && (
                  <a
                    href={r.source_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <ExternalLink size={13} /> 원본
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
