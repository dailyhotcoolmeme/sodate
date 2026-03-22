import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Log {
  id: string; status: string; events_found: number; events_new: number
  events_updated: number; error_message: string | null; duration_ms: number
  executed_at: string; companies: { name: string } | null
}

export default function CrawlLogs() {
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('crawl_logs')
      .select('*, companies(name)')
      .order('executed_at', { ascending: false })
      .limit(100)
      .then(({ data }) => { setLogs((data as any) ?? []); setLoading(false) })
  }, [])

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">크롤링 로그</h1>
      {loading ? <p className="text-gray-400 text-sm">불러오는 중...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">실행시간</th>
                <th className="px-4 py-3 text-left font-medium">업체</th>
                <th className="px-4 py-3 text-center font-medium">상태</th>
                <th className="px-4 py-3 text-right font-medium">발견</th>
                <th className="px-4 py-3 text-right font-medium">신규</th>
                <th className="px-4 py-3 text-right font-medium">수정</th>
                <th className="px-4 py-3 text-right font-medium">소요(ms)</th>
                <th className="px-4 py-3 text-left font-medium">에러</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(log.executed_at).toLocaleString('ko-KR')}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{log.companies?.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      log.status === 'success' ? 'bg-green-100 text-green-700' :
                      log.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{log.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{log.events_found}</td>
                  <td className="px-4 py-2.5 text-right text-green-600 font-medium">+{log.events_new}</td>
                  <td className="px-4 py-2.5 text-right text-blue-600">{log.events_updated}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 text-xs">{log.duration_ms?.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-red-400 text-xs max-w-xs truncate">{log.error_message ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
