import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Images } from 'lucide-react'
import CompanyImageTypes from '../components/CompanyImageTypes'

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
  const [expanded, setExpanded] = useState<string | null>(null)

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

  const expandedCompany = companies.find((c) => c.id === expanded) ?? null

  return (
    <div className="p-4 md:p-8 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">업체 관리</h1>
      {loading ? <p className="text-gray-400 text-sm">불러오는 중...</p> : (
        <>
          {/* 선택된 업체의 상세 이미지 유형 관리 (전체 폭 — 모바일에서도 잘 보이게 테이블 밖) */}
          {expandedCompany && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Images size={16} className="text-gray-500" />
                  <span className="font-semibold text-gray-900">{expandedCompany.name}</span>
                  <span className="text-xs text-gray-400">상세 이미지 유형</span>
                </div>
                <button onClick={() => setExpanded(null)} className="text-xs text-gray-400 hover:text-gray-600">닫기 ✕</button>
              </div>
              <CompanyImageTypes companyId={expandedCompany.id} slug={expandedCompany.slug} />
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                  <tr key={c.id} className={`border-t border-gray-100 hover:bg-gray-50 ${expanded === c.id ? 'bg-gray-50' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{c.name}</p>
                      <p className="text-xs text-gray-400 mb-1.5">{c.slug}</p>
                      <button
                        onClick={() => setExpanded((prev) => prev === c.id ? null : c.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${expanded === c.id ? 'bg-gray-900 text-white' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'}`}
                      >
                        <Images size={13} />
                        이미지 유형 관리
                        {expanded === c.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{c.crawl_type}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{c.regions?.join(', ')}</td>
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
        </>
      )}
    </div>
  )
}
