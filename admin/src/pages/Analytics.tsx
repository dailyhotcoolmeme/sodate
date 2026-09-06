import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import VisitorStats, { type Bucket } from '../components/VisitorStats'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

// 화면 전체가 이 기간 하나를 따른다(2026-09-06). 예전에는 여기와 방문자 칸이
// 기간을 따로 들고 있어서 같은 화면에서 서로 다른 기간을 보여줬다(오너 지적).
const PERIOD_OPTIONS = [
  { label: '오늘', days: 1 },
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
  { label: '전체', days: 3650 },
]

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'day', label: '일별' },
  { key: 'week', label: '주별' },
  { key: 'month', label: '월별' },
]

/** yyyy-mm-dd (한국 날짜 기준) */
function ymd(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}
function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86400_000))
}

const COLORS = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

// 이벤트 종류를 사람이 읽는 말로. 앱 lib/analytics.ts 의 AnalyticsEventType 과 짝이다.
// 여기 없는 값이 들어오면(새 이벤트를 앱에만 추가한 경우) 원래 키를 그대로 보여준다.
const EVENT_LABELS: Record<string, string> = {
  app_open: '앱 실행',
  screen_view: '화면 이동',
  event_impression: '일정 노출',
  event_view: '일정 상세 조회',
  event_apply_click: '신청 클릭',
  event_favorite_add: '찜 추가',
  event_favorite_remove: '찜 해제',
  alert_subscribe: '알림 구독',
  alert_unsubscribe: '알림 구독 해제',
  filter_apply: '필터 적용',
  filter_reset: '필터 초기화',
  sort_change: '정렬 변경',
  company_view: '업체 상세 조회',
  review_view: '후기 조회',
  review_click: '후기 클릭',
  participant_stats_view: '참가자 정보 조회',
  ad_sdk_init: '광고 SDK 초기화',
  ad_slot_mount: '광고 영역 표시',
  ad_request_start: '광고 요청',
  ad_load_success: '광고 로드 성공',
  ad_load_fail: '광고 로드 실패',
}
const eventLabel = (key: string) => EVENT_LABELS[key] ?? key.replace(/_/g, ' ')

/** 나이대 필터 값(25_30)을 '25~30세'로 */
const ageLabel = (key: string) => {
  const m = key.match(/^(\d+)_(\d+)$/)
  return m ? `${m[1]}~${m[2]}세` : key
}

// 정렬 값 → 앱 화면에 실제로 쓰는 문구(app/index.tsx SORT_OPTIONS)와 같게.
// deadline·created 는 지금 앱 화면엔 없지만 예전 기록이 남아 있어 같이 둔다.
const SORT_LABELS: Record<string, string> = {
  date: '날짜순',
  price_low: '가격 낮은순',
  price_high: '가격 높은순',
  deadline: '마감 임박순',
  created: '최신 등록순',
}
const sortLabel = (key: string) => SORT_LABELS[key] ?? key

export default function Analytics() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(daysAgo(0))
  const [bucket, setBucket] = useState<Bucket>('day')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'company' | 'behavior'>('overview')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  /**
   * 집계는 DB에서 한다(admin_analytics RPC).
   *
   * ⚠️ 예전에는 analytics_events 를 통째로 받아 브라우저에서 셌는데, PostgREST 가
   *    한 번에 1000행만 돌려준다. 최근 30일이 9천 건이 넘어가면서 실제로는 임의의
   *    1000건만 보고 모든 숫자를 계산하고 있었다(2026-08-12 실측·확인).
   *    행을 끌어오지 말고 DB가 세서 내려주게 바꿨다 — 몇 건이 쌓여도 정확하다.
   */
  async function load() {
    setLoading(true)
    // 기간을 시작·끝으로 넘긴다 — 예전 admin_analytics(p_days) 는 늘 '오늘까지'라
    // 날짜를 직접 고를 수가 없었다. 같은 본문의 admin_analytics_range 로 바꿨다.
    const { data: agg, error } = await supabase.rpc('admin_analytics_range', {
      p_from: `${from}T00:00:00+09:00`,
      p_to: `${to}T23:59:59.999+09:00`,
    })
    if (error || !agg) { setData(null); setLoading(false); return }

    const counts: Record<string, number> = agg.counts ?? {}
    const funnel = [
      { name: '앱 실행', value: counts['app_open'] ?? 0 },
      { name: '일정 조회', value: counts['event_view'] ?? 0 },
      { name: '신청 클릭', value: counts['event_apply_click'] ?? 0 },
    ]
    const platformData = Object.entries(agg.platforms ?? {})
      .map(([name, value]) => ({ name, value: value as number }))

    setData({
      funnel,
      platformData,
      regionData: agg.regions ?? [],
      ageData: (agg.ages ?? []).map((a: any) => ({ ...a, name: ageLabel(a.name) })),
      companyData: agg.companies ?? [],
      sortData: (agg.sorts ?? []).map((s: any) => ({ ...s, name: sortLabel(s.name) })),
      counts,
      devices: agg.devices ?? 0,
    })
    setLoading(false)
  }

  if (loading) return <div className="p-4 md:p-8 text-gray-400">분석 데이터 로드 중...</div>
  if (!data) return null

  return (
    <div className="p-4 md:p-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">데이터 분석</h1>

      {/* 기간 고르개 — 이 화면 전체가 여기를 따른다 */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_OPTIONS.map((opt) => {
            const on = from === daysAgo(opt.days - 1) && to === daysAgo(0)
            return (
              <button
                key={opt.days}
                onClick={() => {
                  setFrom(daysAgo(opt.days - 1))
                  setTo(daysAgo(0))
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  on ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
          <span className="text-gray-300">|</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
          />
          <span className="text-sm text-gray-400">~</span>
          <input
            type="date"
            value={to}
            min={from}
            max={daysAgo(0)}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBucket(b.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                bucket === b.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {b.label}
            </button>
          ))}
          <span className="text-xs text-gray-400">아래 방문자 표를 이 단위로 묶습니다</span>
        </div>
      </div>

      <VisitorStats from={from} to={to} bucket={bucket} />

      {/* 탭 */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['overview', 'company', 'behavior'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'overview' ? '전체 현황' : t === 'company' ? '업체별 성과' : '사용자 행동'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* 요약 수치 */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: '앱 실행', key: 'app_open' },
              { label: '이벤트 조회', key: 'event_view' },
              { label: '신청 클릭', key: 'event_apply_click' },
              { label: '찜 추가', key: 'event_favorite_add' },
              { label: '알림 구독', key: 'alert_subscribe' },
              { label: '고유 기기', key: '_devices' },
            ].map(({ label, key }) => (
              <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {key === '_devices' ? data.devices.toLocaleString() : (data.counts[key] ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* 전환 퍼널 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">전환 퍼널</h2>
            <div className="flex items-center gap-4">
              {data.funnel.map((item: any, i: number) => {
                const rate = i === 0 ? 100 : data.funnel[0].value > 0
                  ? Math.round(item.value / data.funnel[0].value * 100) : 0
                return (
                  <div key={i} className="flex-1 text-center">
                    <div
                      className="mx-auto rounded-xl flex items-center justify-center text-white font-bold text-lg mb-2"
                      style={{
                        height: Math.max(48, (item.value / (data.funnel[0].value || 1)) * 120),
                        backgroundColor: COLORS[i],
                        opacity: 1 - i * 0.15,
                      }}
                    >
                      {item.value.toLocaleString()}
                    </div>
                    <p className="text-xs font-medium text-gray-700">{item.name}</p>
                    <p className="text-xs text-gray-400">{rate}%</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 지역 + 플랫폼 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">인기 지역 (필터 기준)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.regionData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={40} />
                  <Tooltip />
                  <Bar dataKey="value" name="검색 수" fill="#ec4899" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">플랫폼</h2>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.platformData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {data.platformData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {tab === 'company' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-500 text-xs">
                  <th className="px-4 py-3 font-medium">업체</th>
                  <th className="px-4 py-3 font-medium text-right">이벤트 조회</th>
                  <th className="px-4 py-3 font-medium text-right">신청 클릭</th>
                  <th className="px-4 py-3 font-medium text-right">찜 추가</th>
                  <th className="px-4 py-3 font-medium text-right">전환율</th>
                </tr>
              </thead>
              <tbody>
                {data.companyData.map((row: any, i: number) => {
                  const conv = row.view > 0 ? ((row.apply / row.view) * 100).toFixed(1) : '0.0'
                  return (
                    <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{row.view.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{row.apply.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{row.favorite.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${parseFloat(conv) >= 5 ? 'text-green-600' : parseFloat(conv) >= 2 ? 'text-yellow-600' : 'text-gray-400'}`}>
                          {conv}%
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 업체별 막대 비교 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">업체별 이벤트 조회 vs 신청 클릭</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.companyData.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="view" name="조회" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="apply" name="신청" fill="#ec4899" radius={[4, 4, 0, 0]} />
                <Bar dataKey="favorite" name="찜" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === 'behavior' && (
        <div className="space-y-6">
          {/* 인기 테마 */}
          <div className="grid grid-cols-2 gap-4">
            {/* 예전엔 '인기 테마'였는데 테마 필터가 앱에서 사라져 늘 빈 그래프였다.
                대신 계속 쌓이는데 볼 곳이 없던 나이대 필터를 보여준다(2026-08-12). */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">인기 나이대 (필터 기준)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.ageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="선택 수" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">정렬 사용 패턴</h2>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.sortData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                    {data.sortData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 이벤트 타입별 전체 현황 */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">전체 행동 분포</h2>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(data.counts)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-xs text-gray-600" title={key}>{eventLabel(key)}</span>
                    <span className="text-sm font-bold text-gray-900">{(val as number).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
