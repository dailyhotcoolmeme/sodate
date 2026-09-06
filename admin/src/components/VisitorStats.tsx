// 방문자 분석 (2026-09-06 오너 요청: 방문자수·신규·체류시간, 일별/주별/월별, 기간 지정)
//
// ⚠️ '한 번 방문'을 앱의 session_id 로 세지 않는다. 그 값은 앱이 메모리에 올라와 있는 동안
//    계속 같아서, 백그라운드에 며칠 떠 있으면 체류시간이 7.8일로 나온다(실측).
//    그래서 DB 함수 admin_visitor_stats 가 «같은 기기 기록이 30분 넘게 끊기면 다른 방문»
//    으로 다시 나눈다(구글 애널리틱스와 같은 기준). 지난 기록에도 그대로 적용된다.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type Bucket = 'day' | 'week' | 'month'

interface Row {
  bucket_start: string
  visitors: number
  new_visitors: number
  visits: number
  avg_seconds: number | null
  median_seconds: number | null
}

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'day', label: '일별' },
  { key: 'week', label: '주별' },
  { key: 'month', label: '월별' },
]

const PRESETS: { label: string; days: number }[] = [
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
  { label: '전체', days: 3650 },
]

/** yyyy-mm-dd (한국 날짜 기준) */
function ymd(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600_000)
  return kst.toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86400_000))
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

export default function VisitorStats() {
  const [bucket, setBucket] = useState<Bucket>('day')
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(daysAgo(0))
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    setRows(null)
    // 끝날은 그날 하루를 통째로 포함해야 하므로 다음 날 0시 직전까지 본다.
    const { data, error } = await supabase.rpc('admin_visitor_stats', {
      p_from: `${from}T00:00:00+09:00`,
      p_to: `${to}T23:59:59.999+09:00`,
      p_bucket: bucket,
      p_gap_min: 30,
    })
    if (error) {
      setErr(error.message)
      setRows([])
      return
    }
    setRows((data as Row[]) ?? [])
  }, [from, to, bucket])

  useEffect(() => {
    load()
  }, [load])

  // ⚠️ 방문자 수는 칸끼리 더하면 안 된다 — 같은 사람이 여러 날 오면 중복된다.
  //    그래서 «구간 전체»는 DB 함수의 'all' 모드로 한 줄만 따로 받는다.
  const [total, setTotal] = useState<Row | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setTotal(undefined)
    supabase
      .rpc('admin_visitor_stats', {
        p_from: `${from}T00:00:00+09:00`,
        p_to: `${to}T23:59:59.999+09:00`,
        p_bucket: 'all',
        p_gap_min: 30,
      })
      .then(({ data }) => {
        if (!alive) return
        setTotal(((data as Row[]) ?? [])[0] ?? null)
      })
    return () => {
      alive = false
    }
  }, [from, to])

  const chartData = (rows ?? []).map((r) => ({
    날짜: r.bucket_start.slice(5),
    방문자: r.visitors,
    신규: r.new_visitors,
  }))

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 mb-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-bold text-gray-900">방문자</h2>
        <p className="text-xs text-gray-400">
          같은 기기의 기록이 30분 넘게 끊기면 다른 방문으로 봅니다
        </p>
      </div>

      {/* 기간 고르기 */}
      <div className="flex flex-wrap items-center gap-2 mt-3 mb-4">
        {PRESETS.map((p) => {
          const on = from === daysAgo(p.days - 1) && to === daysAgo(0)
          return (
            <button
              key={p.label}
              onClick={() => {
                setFrom(daysAgo(p.days - 1))
                setTo(daysAgo(0))
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                on ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          )
        })}
        <span className="text-gray-300">|</span>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-gray-400">~</span>
        <input
          type="date"
          value={to}
          min={from}
          max={daysAgo(0)}
          onChange={(e) => setTo(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
        />
        <span className="text-gray-300">|</span>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBucket(b.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              bucket === b.key ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {b.label}
          </button>
        ))}
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
