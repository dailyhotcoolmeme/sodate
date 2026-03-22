import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'

const PERIOD_OPTIONS = [
  { label: '오늘', days: 1 },
  { label: '7일', days: 7 },
  { label: '30일', days: 30 },
  { label: '전체', days: 3650 },
]

const COLORS = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

export default function Analytics() {
  const [period, setPeriod] = useState(30)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'company' | 'behavior'>('overview')

  useEffect(() => {
    load()
  }, [period])

  async function load() {
    setLoading(true)
    const since = new Date(Date.now() - period * 864e5).toISOString()

    const { data: rows } = await supabase
      .from('analytics_events')
      .select('event_type, event_id, company_id, device_id, platform, properties, created_at')
      .gte('created_at', since)

    if (!rows) { setLoading(false); return }

    // 전환 퍼널
    const counts: Record<string, number> = {}
    for (const r of rows) counts[r.event_type] = (counts[r.event_type] ?? 0) + 1

    const funnel = [
      { name: '앱 실행', value: counts['app_open'] ?? 0 },
      { name: '이벤트 조회', value: counts['event_view'] ?? 0 },
      { name: '신청 클릭', value: counts['event_apply_click'] ?? 0 },
    ]

    // 플랫폼 비율
    const platforms: Record<string, number> = {}
    for (const r of rows) if (r.platform) platforms[r.platform] = (platforms[r.platform] ?? 0) + 1
    const platformData = Object.entries(platforms).map(([name, value]) => ({ name, value }))

    // 인기 지역 (filter_apply에서 region 추출)
    const regionCount: Record<string, number> = {}
    for (const r of rows) {
      if (r.event_type === 'filter_apply' && r.properties?.region && r.properties.region !== 'all') {
        const reg = r.properties.region
        regionCount[reg] = (regionCount[reg] ?? 0) + 1
      }
    }
    const regionData = Object.entries(regionCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }))

    // 인기 테마
    const themeCount: Record<string, number> = {}
    for (const r of rows) {
      if (r.event_type === 'filter_apply' && r.properties?.theme) {
        const t = r.properties.theme
        themeCount[t] = (themeCount[t] ?? 0) + 1
      }
    }
    const themeData = Object.entries(themeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }))

    // 업체별 성과
    const companyStats: Record<string, { name: string; view: number; apply: number; favorite: number }> = {}
    const { data: companies } = await supabase.from('companies').select('id, name')
    const companyMap: Record<string, string> = {}
    for (const c of companies ?? []) companyMap[c.id] = c.name

    for (const r of rows) {
      if (!r.company_id) continue
      const name = companyMap[r.company_id] ?? r.company_id.slice(0, 8)
      if (!companyStats[r.company_id]) companyStats[r.company_id] = { name, view: 0, apply: 0, favorite: 0 }
      if (r.event_type === 'event_view') companyStats[r.company_id].view++
      if (r.event_type === 'event_apply_click') companyStats[r.company_id].apply++
      if (r.event_type === 'event_favorite_add') companyStats[r.company_id].favorite++
    }
    const companyData = Object.values(companyStats)
      .sort((a, b) => b.view - a.view)

    // 정렬 사용 패턴
    const sortCount: Record<string, number> = {}
    for (const r of rows) {
      if (r.event_type === 'sort_change' && r.properties?.sort_by) {
        const s = r.properties.sort_by
        sortCount[s] = (sortCount[s] ?? 0) + 1
      }
    }
    const sortData = Object.entries(sortCount).map(([name, value]) => ({ name, value }))

    // 고유 기기 수
    const devices = new Set(rows.map((r) => r.device_id)).size

    setData({ funnel, platformData, regionData, themeData, companyData, sortData, counts, devices })
    setLoading(false)
  }

  if (loading) return <div className="p-8 text-gray-400">분석 데이터 로드 중...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-6">
      {/* 헤더 + 기간 선택 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">데이터 분석</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setPeriod(opt.days)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === opt.days ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">인기 테마 (필터 기준)</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.themeData}>
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
                    <span className="text-xs text-gray-600">{key.replace(/_/g, ' ')}</span>
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
