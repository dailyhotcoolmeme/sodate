import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CalendarDays, Heart, MousePointerClick, Smartphone } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

interface Stats {
  totalEvents: number
  todayEvents: number
  totalFavorites: number
  totalApplyClicks: number
  totalDevices: number
  recentCrawlStatus: { name: string; status: string; events_new: number; executed_at: string }[]
  dailyTrend: { date: string; app_open: number; event_view: number; event_apply_click: number; event_favorite_add: number }[]
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string
  icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString()

      const [
        { count: totalEvents },
        { count: todayEvents },
        { count: totalFavorites },
        { count: totalApplyClicks },
        crawlResult,
        analyticsResult,
      ] = await Promise.all([
        supabase.from('events').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('events').select('*', { count: 'exact', head: true })
          .gte('created_at', today),
        supabase.from('analytics_events').select('*', { count: 'exact', head: true })
          .eq('event_type', 'event_favorite_add'),
        supabase.from('analytics_events').select('*', { count: 'exact', head: true })
          .eq('event_type', 'event_apply_click'),
        supabase.from('crawl_logs')
          .select('companies(name), status, events_new, executed_at')
          .order('executed_at', { ascending: false })
          .limit(8),
        supabase.from('analytics_events')
          .select('event_type, created_at, device_id')
          .gte('created_at', thirtyDaysAgo)
          .in('event_type', ['app_open', 'event_view', 'event_apply_click', 'event_favorite_add']),
      ])

      // 고유 디바이스 수
      const devices = new Set(analyticsResult.data?.map((e) => e.device_id) ?? [])

      // 일별 트렌드 집계
      const trendMap: Record<string, Record<string, number>> = {}
      for (const e of analyticsResult.data ?? []) {
        const date = e.created_at.split('T')[0]
        if (!trendMap[date]) trendMap[date] = { app_open: 0, event_view: 0, event_apply_click: 0, event_favorite_add: 0 }
        trendMap[date][e.event_type] = (trendMap[date][e.event_type] ?? 0) + 1
      }
      const dailyTrend = Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([date, counts]) => ({ date: date.slice(5), ...counts } as any))

      setStats({
        totalEvents: totalEvents ?? 0,
        todayEvents: todayEvents ?? 0,
        totalFavorites: totalFavorites ?? 0,
        totalApplyClicks: totalApplyClicks ?? 0,
        totalDevices: devices.size,
        recentCrawlStatus: (crawlResult.data ?? []).map((r: any) => ({
          name: r.companies?.name ?? '-',
          status: r.status,
          events_new: r.events_new,
          executed_at: new Date(r.executed_at).toLocaleString('ko-KR'),
        })),
        dailyTrend,
      })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="p-8 text-gray-400">불러오는 중...</div>
  if (!stats) return null

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">대시보드</h1>

      {/* 핵심 지표 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="전체 이벤트" value={stats.totalEvents} sub={`오늘 +${stats.todayEvents}`} icon={CalendarDays} color="bg-blue-500" />
        <StatCard label="앱 사용 기기" value={stats.totalDevices} sub="30일 기준" icon={Smartphone} color="bg-purple-500" />
        <StatCard label="신청 클릭" value={stats.totalApplyClicks} sub="누적" icon={MousePointerClick} color="bg-pink-500" />
        <StatCard label="찜 추가" value={stats.totalFavorites} sub="누적" icon={Heart} color="bg-red-500" />
      </div>

      {/* 일별 트렌드 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">최근 14일 트렌드</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={stats.dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="app_open" name="앱 실행" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="event_view" name="이벤트 조회" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="event_apply_click" name="신청 클릭" stroke="#ec4899" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="event_favorite_add" name="찜 추가" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 최근 크롤링 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">최근 크롤링 현황</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 text-xs border-b border-gray-100">
              <th className="pb-2 font-medium">업체</th>
              <th className="pb-2 font-medium">상태</th>
              <th className="pb-2 font-medium">신규</th>
              <th className="pb-2 font-medium">실행시간</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentCrawlStatus.map((row, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="py-2 font-medium text-gray-800">{row.name}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    row.status === 'success' ? 'bg-green-100 text-green-700' :
                    row.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{row.status}</span>
                </td>
                <td className="py-2 text-gray-600">+{row.events_new}</td>
                <td className="py-2 text-gray-400 text-xs">{row.executed_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
