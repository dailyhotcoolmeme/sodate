import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

/**
 * 메뉴별 상세 — 2026-09-03 오너 지시("대시보드에 메뉴별 탭이 필요해").
 *
 * 두 갈래로 나뉜다.
 *  · 콘텐츠 현황 — 서버에 쌓인 것(일정·매장·글). 지금 바로 나온다.
 *  · 사용자 행동 — 계측 기록. **2026-09-03 에 심었으므로 그 뒤부터** 쌓인다. 그 전에는
 *    소개팅 화면에만 계측이 있었고, 어느 메뉴인지도 일정 번호로 되짚는 구조라 지난 일정이
 *    지워지면 알 수 없었다(60일 기록의 89%가 그랬다). 되살릴 수 없어서 화면에도 그렇게 적는다.
 */

const MENUS = [
  { key: 'dating', label: '소개팅' },
  { key: 'socialing', label: '소셜링' },
  { key: 'honsul', label: '혼술바' },
  { key: 'board', label: '커뮤니티' },
] as const
type MenuKey = (typeof MENUS)[number]['key']

// 0 = 오늘(한국시간 자정부터 지금까지). 지난 24시간이 아니라 달력 하루다.
const RANGES = [
  { days: 0, label: '오늘' },
  { days: 7, label: '7일' },
  { days: 30, label: '30일' },
  { days: 90, label: '90일' },
]

interface Stats {
  behavior: {
    menu_view_devices?: number
    menu_views?: number
    item_views?: number
    outlinks?: number
    searches?: number
    zero_searches?: number
    daily?: { date: string; devices: number; views: number }[]
    top_items?: { title: string; views: number }[]
    top_searches?: { term: string; count: number; avg_results: number }[]
    zero_result_searches?: { term: string; count: number }[]
    top_filters?: { kind: string; value: string; count: number }[]
  }
  content: Record<string, any>
}

function Num({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-900">{(value ?? 0).toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

/** 순위표 — 값이 없으면 왜 없는지 한 줄로 알려준다(빈 표만 보이면 고장난 줄 안다) */
function Rank({ title, rows, empty }: {
  title: string
  rows: { name: string; value: number; sub?: string }[]
  empty: string
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 py-3">{empty}</p>
      ) : (
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <span className="w-4 text-xs text-gray-400 tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate text-gray-800">{r.name}</span>
              {r.sub && <span className="text-xs text-gray-400">{r.sub}</span>}
              <span className="font-semibold text-gray-900 tabular-nums">{r.value.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function MenuStats() {
  const [menu, setMenu] = useState<MenuKey>('dating')
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase.rpc('admin_menu_stats', { p_menu: menu, p_days: days }).then(({ data }) => {
      if (cancelled) return
      setStats((data ?? { behavior: {}, content: {} }) as Stats)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [menu, days])

  const b = stats?.behavior ?? {}
  const c = stats?.content ?? {}
  const isBoard = menu === 'board'
  const isHonsul = menu === 'honsul'
  // 계측을 심은 날부터만 쌓인다 — 숫자가 0이면 고장이 아니라 아직 안 쌓인 것이다.
  const noBehavior = !b.menu_views && !b.item_views && !b.searches
  const periodLabel = days === 0 ? '오늘' : `최근 ${days}일`

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-gray-700">메뉴별 상세</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                days === r.days ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* 메뉴 탭 */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {MENUS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMenu(m.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              menu === m.key
                ? 'border-pink-500 text-pink-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >{m.label}</button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-10 text-center">불러오는 중...</p>
      ) : (
        <div className="space-y-6">
          {/* 콘텐츠 현황 — 지금 바로 나오는 값 */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-2">콘텐츠 현황</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {isBoard ? (
                <>
                  <Num label="글" value={c.items} sub={`${periodLabel} +${(c.items_new ?? 0).toLocaleString()}`} />
                  <Num label="댓글" value={c.comments} />
                  <Num label="글 조회 합계" value={c.views} />
                  <Num
                    label="글쓰기 완료율"
                    value={c.write_start ? Math.round((c.write_submit / c.write_start) * 100) : 0}
                    sub={c.write_start ? `시작 ${c.write_start} → 완료 ${c.write_submit}` : '계측 심은 뒤부터'}
                  />
                </>
              ) : isHonsul ? (
                <>
                  <Num label="매장" value={c.items} sub={`${periodLabel} +${(c.items_new ?? 0).toLocaleString()}`} />
                  <Num label="제휴 매장" value={c.partners} />
                  <Num label="모잇 후기" value={c.reviews} />
                  <Num label="상세 열람" value={b.item_views} sub={periodLabel} />
                </>
              ) : (
                <>
                  <Num label="일정" value={c.items} sub={`${periodLabel} +${(c.items_new ?? 0).toLocaleString()}`} />
                  <Num label="업체" value={c.companies} />
                  <Num label="상세 열람" value={b.item_views} sub={periodLabel} />
                  <Num label="신청 클릭" value={b.outlinks} sub={periodLabel} />
                </>
              )}
            </div>
          </div>

          {/* 사용자 행동 — 계측 심은 뒤부터 */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-semibold text-gray-600">사용자 행동</p>
              {noBehavior && (
                <span className="text-xs text-gray-400">
                  2026-09-03에 계측을 심었습니다. 그 전 기록은 없습니다
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <Num label="방문 기기" value={b.menu_view_devices} />
              <Num label="방문 횟수" value={b.menu_views} />
              <Num label="검색" value={b.searches} sub={`0건 ${(b.zero_searches ?? 0).toLocaleString()}회`} />
              <Num label="상세 열람" value={b.item_views} />
            </div>

            {(b.daily?.length ?? 0) > 0 && (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={b.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="devices" name="방문 기기" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="views" name="방문 횟수" stroke="#3b82f6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 순위표 */}
          <div className="grid md:grid-cols-2 gap-6">
            <Rank
              title="많이 본 항목"
              rows={(b.top_items ?? []).map((t) => ({ name: t.title, value: t.views }))}
              empty="계측을 심은 뒤부터 쌓입니다"
            />
            <Rank
              title="인기 검색어"
              rows={(b.top_searches ?? []).map((t) => ({ name: t.term, value: t.count, sub: `평균 ${t.avg_results}건` }))}
              empty="계측을 심은 뒤부터 쌓입니다"
            />
            <Rank
              title="결과 0건 검색어 — 찾는데 물건이 없는 것"
              rows={(b.zero_result_searches ?? []).map((t) => ({ name: t.term, value: t.count }))}
              empty="아직 없습니다"
            />
            <Rank
              title="많이 쓴 필터"
              rows={(b.top_filters ?? []).map((t) => ({ name: `${t.value}`, value: t.count, sub: t.kind }))}
              empty="계측을 심은 뒤부터 쌓입니다"
            />

            {isBoard ? (
              <>
                <Rank
                  title="조회수 높은 글"
                  rows={(c.top_posts ?? []).map((p: any) => ({ name: p.title, value: p.views, sub: `댓글 ${p.comments}` }))}
                  empty="글이 없습니다"
                />
                <Rank
                  title="말머리별 글 수"
                  rows={(c.by_tag ?? []).map((t: any) => ({ name: t.name, value: t.count }))}
                  empty="말머리가 없습니다"
                />
              </>
            ) : (
              <>
                <Rank
                  title={isHonsul ? '지역별 매장 수' : '지역별 일정 수'}
                  rows={(c.by_region ?? []).map((r: any) => ({ name: r.name, value: r.count }))}
                  empty="자료가 없습니다"
                />
                {!isHonsul && (
                  <Rank
                    title="업체별 일정 수"
                    rows={(c.by_company ?? []).map((r: any) => ({ name: r.name, value: r.count }))}
                    empty="자료가 없습니다"
                  />
                )}
              </>
            )}
          </div>

          {/* 커뮤니티 일별 글·댓글 — 서버 기록이라 예전 것까지 다 나온다 */}
          {isBoard && (c.daily_posts?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">일별 글·댓글</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={c.daily_posts}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="posts" name="글" fill="#ec4899" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="comments" name="댓글" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
