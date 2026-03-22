import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ToggleLeft, ToggleRight } from 'lucide-react'

interface Company {
  id: string; name: string; slug: string; base_url: string
  crawl_type: string; is_active: boolean; plan: string
  regions: string[]; created_at: string
}

const PLAN_LABELS: Record<string, string> = { free: '무료', basic: '베이직', pro: '프로' }
const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  basic: 'bg-blue-100 text-blue-700',
  pro: 'bg-yellow-100 text-yellow-700',
}

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('companies').select('*').order('created_at').then(({ data }) => {
      setCompanies((data as any) ?? [])
      setLoading(false)
    })
  }, [])

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('companies').update({ is_active: !current }).eq('id', id)
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !current } : c))
  }

  async function updatePlan(id: string, plan: string) {
    await supabase.from('companies').update({ plan }).eq('id', id)
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, plan } : c))
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">업체 관리</h1>
      {loading ? <p className="text-gray-400 text-sm">불러오는 중...</p> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">업체명</th>
                <th className="px-4 py-3 text-left font-medium">크롤링 방식</th>
                <th className="px-4 py-3 text-left font-medium">지역</th>
                <th className="px-4 py-3 text-center font-medium">플랜</th>
                <th className="px-4 py-3 text-center font-medium">크롤링</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.crawl_type}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.regions?.join(', ')}</td>
                  <td className="px-4 py-3 text-center">
                    <select
                      value={c.plan ?? 'free'}
                      onChange={(e) => updatePlan(c.id, e.target.value)}
                      className={`px-2 py-1 rounded-full text-xs font-medium border-0 focus:outline-none ${PLAN_COLORS[c.plan ?? 'free']}`}
                    >
                      {Object.entries(PLAN_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(c.id, c.is_active)}>
                      {c.is_active
                        ? <ToggleRight size={22} className="text-green-500 mx-auto" />
                        : <ToggleLeft size={22} className="text-gray-300 mx-auto" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
