// 방문자 분석 (2026-09-06 오너 요청: 방문자수·신규·체류시간, 일별/주별/월별, 기간 지정)
//
// ⚠️ '한 번 방문'을 앱의 session_id 로 세지 않는다. 그 값은 앱이 메모리에 올라와 있는 동안
//    계속 같아서, 백그라운드에 며칠 떠 있으면 체류시간이 7.8일로 나온다(실측).
//    그래서 DB 함수 admin_visitor_stats 가 «같은 기기 기록이 30분 넘게 끊기면 다른 방문»
//    으로 다시 나눈다(구글 애널리틱스와 같은 기준). 지난 기록에도 그대로 적용된다.
//
// 기간은 화면(Analytics.tsx)이 하나로 들고 있고 여기는 받아서 쓴다 — 예전에는 이 칸이
// 기간을 따로 들고 있어서, 화면 위쪽 버튼과 서로 다른 기간을 보여주고 있었다(오너 지적).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export type Bucket = 'day' | 'week' | 'month'

interface Row {
  bucket_start: string
  visitors: number
  new_visitors: number
  visits: number
  avg_seconds: number | null
  median_seconds: number | null
}

/** 초 → '3분 20초'. 화면 어디서나 같은 모양으로 쓴다. */
function dur(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0))
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분 ${s % 60}초`
  return `${Math.floor(m / 60)}시간 ${m % 60}분`
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3.5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

export default function VisitorStats({
  from,
  to,
  bucket,
}: {
  from: string
  to: string
  bucket: Bucket
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState<Row | null | undefined>(undefined)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setErr('')
    setRows(null)
    setTotal(undefined)
    // 끝날은 그날 하루를 통째로 포함해야 하므로 그날 23:59:59.999 까지 본다.
    const args = { p_from: `${from}T00:00:00+09:00`, p_to: `${to}T23:59:59.999+09:00`, p_gap_min: 30 }

    supabase.rpc('admin_visitor_stats', { ...args, p_bucket: bucket }).then(({ data, error }) => {
      if (!alive) return
      if (error) {
        setErr(error.message)
        setRows([])
        return
      }
      setRows((data as Row[]) ?? [])
    })

    // ⚠️ 방문자 수는 칸끼리 더하면 안 된다 — 같은 사람이 여러 날 오면 중복된다.
    //    그래서 «구간 전체»는 함수의 'all' 모드로 한 줄만 따로 받는다.
    supabase.rpc('admin_visitor_stats', { ...args, p_bucket: 'all' }).then(({ data }) => {
      if (!alive) return
      setTotal(((data as Row[]) ?? [])[0] ?? null)
    })

    return () => {
      alive = false
    }
  }, [from, to, bucket])

  const chartData = (rows ?? []).map((r) => ({
    날짜: r.bucket_start.slice(5),
    방문자: r.visitors,
    신규: r.new_visitors,
  }))

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-base font-bold text-gray-900">방문자</h2>
        <p className="text-xs text-gray-400">
          같은 기기의 기록이 30분 넘게 끊기면 다른 방문으로 봅니다
        </p>
      </div>

      {err && <p className="text-sm text-red-500 mb-3">불러오지 못했습니다: {err}</p>}
      {rows === null && <p className="text-sm text-gray-400">불러오는 중…</p>}
      {rows?.length === 0 && !err && <p className="text-sm text-gray-400">이 기간에는 기록이 없습니다.</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Card
              label="방문자 (중복 제외)"
              value={total ? `${total.visitors.toLocaleString()}명` : '…'}
              hint="기간 안에 온 서로 다른 기기 수"
            />
            <Card
              label="신규 방문자"
              value={total ? `${total.new_visitors.toLocaleString()}명` : '…'}
              hint="이 기간에 처음 온 기기"
            />
            <Card label="방문 횟수" value={total ? `${total.visits.toLocaleString()}회` : '…'} />
            <Card
              label="평균 체류시간"
              value={total ? dur(total.avg_seconds) : '…'}
              hint={total ? `중앙값 ${dur(total.median_seconds)}` : '방문 한 번당'}
            />
          </div>

          <div className="h-56 mb-5">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="날짜" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="방문자" stroke="#ec4899" fill="#fce7f3" strokeWidth={2} />
                <Area type="monotone" dataKey="신규" stroke="#8b5cf6" fill="#ede9fe" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left font-medium py-2 pr-3">기간</th>
                  <th className="text-right font-medium py-2 px-3">방문자</th>
                  <th className="text-right font-medium py-2 px-3">신규</th>
                  <th className="text-right font-medium py-2 px-3">방문</th>
                  <th className="text-right font-medium py-2 px-3">평균 체류</th>
                  <th className="text-right font-medium py-2 pl-3">중앙값</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.bucket_start} className="border-b border-gray-50">
                    <td className="py-2 pr-3 text-gray-700">{r.bucket_start}</td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-900 tabular-nums">
                      {r.visitors.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-purple-600 tabular-nums">
                      {r.new_visitors.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 tabular-nums">
                      {r.visits.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-600 tabular-nums">{dur(r.avg_seconds)}</td>
                    <td className="py-2 pl-3 text-right text-gray-400 tabular-nums">{dur(r.median_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            체류시간은 «그 방문에서 처음 기록부터 마지막 기록까지»입니다. 마지막 화면을 보고 앱을 끄기까지의
            시간은 알 수 없어 빠집니다(구글 애널리틱스도 같은 방식이라 실제보다 조금 짧게 나옵니다).
            중앙값이 평균보다 훨씬 작으면, 잠깐 보고 나가는 사람이 많고 오래 보는 사람이 소수라는 뜻입니다.
          </p>
        </>
      )}
    </section>
  )
}
