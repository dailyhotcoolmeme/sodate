import { useEffect, useState, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Star, Flag } from 'lucide-react'

interface Review {
  id: string
  company_id: string
  source: string
  author_name: string | null
  content: string | null
  rating: number | null
  report_count: number | null
  is_active: boolean
  published_at: string | null
  created_at: string | null
  companies: { name: string } | null
}

interface Report {
  id: string
  review_id: string
  reason: string | null
  created_at: string | null
}

type Tab = 'user' | 'reported' | 'hidden' | 'naver_blog' | 'instagram' | 'youtube'

export default function Reviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('user')   // 자체 후기 관리가 이 화면의 핵심(오너 확정)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [reportsLoading, setReportsLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('reviews')
      .select('id, company_id, source, author_name, content, rating, report_count, is_active, published_at, created_at, companies(name)')
      // ⚠️ 예전엔 .or('source.eq.user,report_count.gt.0')로 걸러서, 앱 작성 후기와
      //    신고 후기가 모두 0건이 되자 화면이 통째로 비었다(후기는 666건 있는데도).
      //    전부 불러오고 화면의 탭으로 좁힌다.
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(1000)
    setReviews((data as any) ?? [])
    setLoading(false)
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('reviews').update({ is_active: !current }).eq('id', id)
    setReviews((prev) => prev.map((r) => r.id === id ? { ...r, is_active: !current } : r))
  }

  async function deleteReview(id: string) {
    if (!confirm('이 후기를 완전히 삭제하시겠습니까? 연관된 신고 기록도 함께 삭제됩니다.')) return
    await supabase.from('reviews').delete().eq('id', id)
    setReviews((prev) => prev.filter((r) => r.id !== id))
    if (expanded === id) setExpanded(null)
  }

  async function toggleReports(reviewId: string) {
    if (expanded === reviewId) { setExpanded(null); return }
    setExpanded(reviewId)
    setReportsLoading(true)
    setReports([])
    const { data } = await supabase
      .from('review_reports')
      .select('id, review_id, reason, created_at')
      .eq('review_id', reviewId)
      .order('created_at', { ascending: false })
    setReports((data as any) ?? [])
    setReportsLoading(false)
  }

  const counts = useMemo(() => ({
    user: reviews.filter((r) => r.source === 'user').length,
    reported: reviews.filter((r) => (r.report_count ?? 0) > 0).length,
    hidden: reviews.filter((r) => !r.is_active).length,
    naver_blog: reviews.filter((r) => r.source === 'naver_blog').length,
    instagram: reviews.filter((r) => r.source === 'instagram').length,
    youtube: reviews.filter((r) => r.source === 'youtube').length,
  }), [reviews])

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (tab === 'reported' && !((r.report_count ?? 0) > 0)) return false
      if (tab === 'user' && r.source !== 'user') return false
      if (tab === 'hidden' && r.is_active) return false
      if (tab === 'naver_blog' && r.source !== 'naver_blog') return false
      if (tab === 'instagram' && r.source !== 'instagram') return false
      if (tab === 'youtube' && r.source !== 'youtube') return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${r.companies?.name ?? ''} ${r.author_name ?? ''} ${r.content ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [reviews, tab, search])

  // 자체 후기(사용자 작성)와 그에 대한 신고·숨김 관리가 이 화면의 핵심(오너 확정).
  // 크롤 후기(블로그·인스타·유튜브)는 출처별로 나눠 뒤에 둔다 — 목록에서 본문을 길게
  // 볼 이유가 없고(열어봐야 파악됨), 삭제해도 다음 크롤에 되살아나므로 참고용이다.
  const TABS: [Tab, string, number][] = [
    ['user', '사용자 후기', counts.user],
    ['reported', '신고됨', counts.reported],
    ['hidden', '숨김', counts.hidden],
    ['naver_blog', '블로그', counts.naver_blog],
    ['instagram', '인스타', counts.instagram],
    ['youtube', '유튜브', counts.youtube],
  ]

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">
          후기 관리
          <span className="text-base font-normal text-gray-400 ml-2">({filtered.length}개)</span>
        </h1>
      </div>

      {/* 필터 탭 */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === key ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
            <span className={`text-xs ${tab === key ? 'text-pink-100' : 'text-gray-400'}`}>{count}</span>
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className="relative max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="업체명, 닉네임, 내용 검색..."
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[1060px] table-fixed text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap w-[130px]">업체</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap w-[150px]">닉네임</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap w-[70px]">별점</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap">내용</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap w-[80px]">신고수</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap w-[86px]">노출</th>
                <th className="px-3 py-3 text-left font-medium whitespace-nowrap w-[110px]">작성일</th>
                <th className="px-3 py-3 text-center font-medium whitespace-nowrap w-[150px]">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((review) => {
                const reportCount = review.report_count ?? 0
                const isExpanded = expanded === review.id
                return (
                  <Fragment key={review.id}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50 align-middle [&>td]:whitespace-nowrap">
                      <td className="px-3 py-3 text-gray-500 text-xs"><span className="block truncate" title={review.companies?.name ?? ''}>{review.companies?.name ?? '-'}</span></td>
                      <td className="px-3 py-3 text-gray-700 text-xs truncate">
                        <span className="block truncate" title={review.author_name ?? ''}>{review.author_name ?? '익명'}</span>
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {review.rating != null ? (
                          <span className="flex items-center gap-0.5 text-yellow-500">
                            <Star size={12} className="fill-yellow-400 text-yellow-400" /> {review.rating}
                          </span>
                        ) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="px-3 py-3">
                        {/* 한 줄 말줄임 — 행마다 높이가 달라지지 않게(오너 확정). 전문은
                            마우스 올리거나 [내용] 버튼으로 펼쳐 본다. */}
                        <p className="text-gray-800 text-xs truncate" title={review.content ?? ''}>{review.content ?? '-'}</p>
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {reportCount > 0 ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-semibold">
                            <Flag size={11} /> {reportCount}
                          </span>
                        ) : <span className="text-gray-300 text-xs">0</span>}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {review.is_active ? (
                          <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-xs font-medium">노출 중</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">숨김</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {/* 인스타·유튜브는 크롤러가 게시일(published_at)을 못 채운다(전건 없음).
                            그 경우 수집일(created_at)이라도 보여준다 — 전부 '-'로 비어 보이던 문제. */}
                        {review.published_at
                          ? new Date(review.published_at).toLocaleDateString('ko-KR')
                          : review.created_at
                            ? `${new Date(review.created_at).toLocaleDateString('ko-KR')} 수집`
                            : '-'}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                          {review.is_active ? (
                            <button
                              onClick={() => toggleActive(review.id, review.is_active)}
                              className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-100 shrink-0 whitespace-nowrap"
                            >
                              블라인드
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleActive(review.id, review.is_active)}
                              className="px-2.5 py-1 rounded-lg border border-green-200 text-xs font-medium text-green-600 hover:bg-green-50 shrink-0 whitespace-nowrap"
                            >
                              복구
                            </button>
                          )}
                          {reportCount > 0 && (
                            <button
                              onClick={() => toggleReports(review.id)}
                              className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            >
                              {isExpanded ? '사유 닫기' : '신고 사유 보기'}
                            </button>
                          )}
                          <button
                            onClick={() => deleteReview(review.id)}
                            className="px-2.5 py-1 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 shrink-0 whitespace-nowrap"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-gray-100 bg-gray-50/60">
                        <td colSpan={8} className="px-4 py-3">
                          {reportsLoading ? (
                            <p className="text-gray-400 text-xs">신고 사유 불러오는 중...</p>
                          ) : reports.length === 0 ? (
                            <p className="text-gray-400 text-xs">등록된 신고 사유가 없습니다.</p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium text-gray-500">신고 사유 ({reports.length}건)</p>
                              {reports.map((rep) => (
                                <div key={rep.id} className="flex items-start gap-2 text-xs text-gray-700">
                                  <Flag size={12} className="text-red-400 mt-0.5 shrink-0" />
                                  <span className="flex-1">{rep.reason || '(사유 없음)'}</span>
                                  <span className="text-gray-400 whitespace-nowrap">
                                    {rep.created_at ? new Date(rep.created_at).toLocaleDateString('ko-KR') : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">
                    조건에 맞는 후기가 없습니다.
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
