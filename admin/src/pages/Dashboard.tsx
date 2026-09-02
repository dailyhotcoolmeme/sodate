import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import MenuStats from '../components/MenuStats'
import { CalendarDays, Heart, MousePointerClick, Smartphone } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const KST_OFFSET_MS = 9 * 3600 * 1000

// ⚠️(2026-08-13) new Date().toISOString().split('T')[0] 은 항상 UTC 날짜라, 한국시간
// 00~09시엔 어제 날짜가 나온다("오늘" 카드가 통째로 어제 데이터를 보여줌). 브라우저
// locale에도 기대지 않고(관리자가 항상 한국에서 접속한다는 보장 없음) 순수 시각 계산으로
// "지금 이 순간의 한국 달력일 자정"을 UTC 인스턴트로 구해 DB 비교에 쓴다.
function kstMidnightUTC(date = new Date()): Date {
  const kst = new Date(date.getTime() + KST_OFFSET_MS)
  const kstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
  return new Date(kstMidnight - KST_OFFSET_MS)
}

// UTC ISO 문자열(created_at)을 한국 달력일(YYYY-MM-DD)로. 같은 트릭: +9h 해서 UTC로 자르면
// 그게 곧 한국 날짜다.
function kstDateStr(iso: string): string {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).toISOString().split('T')[0]
}

/** 설치 기기 집계(admin_device_stats RPC). 로그인이 없는 앱이라 '회원수'가 없어서,
 *  앱 실행 때 남는 기기 고유값을 센다 — 재설치·기기 2대는 중복이라 회원수보다 큰 숫자다. */
interface DeviceStats {
  total: number
  d30: number
  d7: number
  today: number
  yesterday: number
  platforms: Record<string, number>
  monthly: { month: string; new: number }[]
}

interface Stats {
  totalEvents: number
  todayEvents: number
  totalFavorites: number
  totalApplyClicks: number
  devices: DeviceStats
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
      const today = kstMidnightUTC().toISOString()
      const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5).toISOString()

      const [
        { count: totalEvents },
        { count: todayEvents },
        { count: totalFavorites },
        { count: totalApplyClicks },
        crawlResult,
        analyticsResult,
        deviceResult,
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
        supabase.rpc('admin_device_stats'),
      ])

      // ⚠️ 기기 수를 예전엔 위 analyticsResult 를 브라우저에서 Set 으로 세었는데, PostgREST 가
      //    기본 1,000행에서 끊어서 **실제보다 적게 나오고 있었다**(30일치가 4천 행 가까이 된다).
      //    집계는 DB 함수에서 끝낸다 — 행 수와 무관하게 정확하다.
      const devices = (deviceResult.data ?? {
        total: 0, d30: 0, d7: 0, today: 0, yesterday: 0, platforms: {}, monthly: [],
      }) as DeviceStats

      // 일별 트렌드 집계
      const trendMap: Record<string, Record<string, number>> = {}
      for (const e of analyticsResult.data ?? []) {
        const date = kstDateStr(e.created_at)
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
        devices,
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

  if (loading) return <div className="p-4 md:p-8 text-gray-400">불러오는 중...</div>
  if (!stats) return null

  return (
    <div className="p-4 md:p-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">대시보드</h1>

      {/* 핵심 지표 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="전체 이벤트" value={stats.totalEvents} sub={`오늘 +${stats.todayEvents}`} icon={CalendarDays} color="bg-blue-500" />
        <StatCard label="설치 기기" value={stats.devices.total} sub={`30일 ${stats.devices.d30.toLocaleString()}`} icon={Smartphone} color="bg-purple-500" />
        <StatCard label="신청 클릭" value={stats.totalApplyClicks} sub="누적" icon={MousePointerClick} color="bg-pink-500" />
        <StatCard label="찜 추가" value={stats.totalFavorites} sub="누적" icon={Heart} color="bg-red-500" />
      </div>

      {/* 설치 기기 — 로그인이 없는 앱이라 '회원수'가 없다. 기기 고유값으로 세는 것이고
          재설치·기기 2대는 중복이라 회원수보다 큰 숫자다. 화면에도 그렇게 적어 둔다. */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">설치 기기</h2>
          <span className="text-xs text-gray-400">
            앱을 지웠다 다시 깔거나 기기를 두 대 쓰면 중복으로 세어집니다 · 한국시간 기준
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            { label: '누적', value: stats.devices.total },
            { label: '최근 30일', value: stats.devices.d30 },
            { label: '최근 7일', value: stats.devices.d7 },
            { label: '오늘', value: stats.devices.today, sub: `어제 ${stats.devices.yesterday.toLocaleString()}` },
          ].map((m) => (
            <div key={m.label} className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">{m.label}</p>
              <p className="text-xl font-bold text-gray-900">{m.value.toLocaleString()}</p>
              {m.sub && <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-4 text-xs">
          {Object.entries(stats.devices.platforms).map(([k, v]) => (
            <span key={k} className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
              {k === 'ios' ? '아이폰' : k === 'android' ? '안드로이드' : k} {v.toLocaleString()}
            </span>
          ))}
        </div>

        {/* 월별 '신규' — 그 달에 처음 나타난 기기만 센다(같은 기기가 여러 달에 겹치지 않는다) */}
        <p className="text-xs text-gray-500 mb-2">월별 신규 기기</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={stats.devices.monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip formatter={(v: any) => [`${Number(v).toLocaleString()}대`, '신규 기기']} />
            <Bar dataKey="new" fill="#a855f7" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 메뉴별 상세 — 소개팅·소셜링·혼술바·커뮤니티 탭(2026-09-03 오너 지시) */}
      <MenuStats />

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
