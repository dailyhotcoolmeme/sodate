import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Images, AlertTriangle } from 'lucide-react'
import CompanyImageTypes from '../components/CompanyImageTypes'

interface Company {
  id: string; name: string; slug: string; base_url: string
  crawl_type: string; is_active: boolean; plan: string
  regions: string[]; created_at: string
  app_visible: boolean // 앱 노출 여부(false=모임리스트·필터칩에서 완전 숨김)
  detail_images_visible: boolean // false면 이미지가 있어도 앱 상세화면의 "상세 설명" 섹션을 숨김
}

// 집계는 DB 뷰(company_admin_stats)에서 받는다. 예전처럼 브라우저에서 events를 전부
// 받아 세면 PostgREST 1000행 상한에 조용히 잘린다(현재 창 안 832건 — 곧 넘김).
interface Stats {
  company_id: string
  upcoming_events: number
  image_type_count: number
  image_count: number
  last_success_at: string | null
  last_executed_at: string | null
  last_status: string | null
}

// 마지막 크롤 성공이 이만큼 지나면 "조용히 멈춘 것"으로 본다.
// 크롤은 하루 2회(08시·20시 KST)라 하루를 넘기면 최소 2회 연속 실패다.
const STALE_HOURS = 30

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-gray-200'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function sinceLabel(iso: string | null): { text: string; hours: number | null } {
  if (!iso) return { text: '기록 없음', hours: null }
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000
  if (hours < 1) return { text: '방금', hours }
  if (hours < 24) return { text: `${Math.floor(hours)}시간 전`, hours }
  return { text: `${Math.floor(hours / 24)}일 전`, hours }
}

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [co, st] = await Promise.all([
        supabase.from('companies').select('*').order('created_at'),
        supabase.from('company_admin_stats').select('*'),
      ])
      if (co.error) { setErr(co.error.message); setLoading(false); return }
      setCompanies((co.data as any) ?? [])
      const map: Record<string, Stats> = {}
      for (const s of ((st.data as any[]) ?? [])) map[s.company_id] = s
      setStats(map)
      setLoading(false)
    }
    load()
  }, [])

  // 저장 실패를 조용히 넘기지 않는다 — 예전엔 error를 안 봐서 실패해도 화면만 바뀌었다.
  async function patch(id: string, patch: Partial<Company>, revert: Partial<Company>) {
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, ...patch } : c))
    const { error } = await supabase.from('companies').update(patch).eq('id', id)
    if (error) {
      setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, ...revert } : c))
      setErr(`저장 실패: ${error.message}`)
    }
  }

  const stale = companies.filter((c) => {
    if (!c.is_active) return false
    const { hours } = sinceLabel(stats[c.id]?.last_success_at ?? null)
    return hours === null || hours > STALE_HOURS
  })

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-bold text-gray-900">업체 관리</h1>
        <span className="text-sm text-gray-400">{companies.length}곳</span>
      </div>

      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{err}</p>
          <button onClick={() => setErr(null)} className="text-xs text-red-400 hover:text-red-600">닫기</button>
        </div>
      )}

      {/* 조용히 멈춘 크롤을 맨 위에서 잡아준다. 업체별 마지막 성공 시각을 볼 수단이
          없어서, 가격이 며칠째 안 갱신되는 걸 뒤늦게 발견한 사고가 있었다. */}
      {!loading && stale.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">크롤이 멈춘 업체 {stale.length}곳</span>
            <span className="text-amber-700"> — {stale.map((c) => c.name).join(', ')}</span>
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => {
            const s = stats[c.id]
            const since = sinceLabel(s?.last_success_at ?? null)
            const isStale = c.is_active && (since.hours === null || since.hours > STALE_HOURS)
            const isOpen = expanded === c.id
            return (
              <div key={c.id} className="contents">
                <div
                  className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${
                    isOpen ? 'border-pink-300 bg-pink-50/40' : 'border-gray-200'
                  }`}
                >
                  <p className="font-semibold text-gray-900 truncate">{c.name}</p>

                  {/* 현황 3종 */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg py-2">
                      <p className="text-base font-bold text-gray-900 tabular-nums">{s?.upcoming_events ?? 0}</p>
                      <p className="text-xs text-gray-400">일정</p>
                    </div>
                    <div className={`rounded-lg py-2 ${s?.image_count ? 'bg-gray-50' : 'bg-orange-50'}`}>
                      <p className={`text-base font-bold tabular-nums ${s?.image_count ? 'text-gray-900' : 'text-orange-600'}`}>
                        {s?.image_count ?? 0}
                      </p>
                      <p className={`text-xs ${s?.image_count ? 'text-gray-400' : 'text-orange-500'}`}>상세 이미지</p>
                    </div>
                    <div className={`rounded-lg py-2 ${isStale ? 'bg-amber-50' : 'bg-gray-50'}`}>
                      <p className={`text-sm font-bold ${isStale ? 'text-amber-700' : 'text-gray-900'}`}>{since.text}</p>
                      <p className={`text-xs ${isStale ? 'text-amber-500' : 'text-gray-400'}`}>마지막 수집</p>
                    </div>
                  </div>

                  {/* 토글 2종 — 아이콘만으로는 뭘 켜는 건지 안 보여 라벨을 같이 둔다 */}
                  <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
                    {([
                      ['크롤링', c.is_active, () => patch(c.id, { is_active: !c.is_active }, { is_active: c.is_active })],
                      ['앱 노출', c.app_visible, () => patch(c.id, { app_visible: !c.app_visible }, { app_visible: c.app_visible })],
                      ['상세 이미지', c.detail_images_visible, () => patch(c.id, { detail_images_visible: !c.detail_images_visible }, { detail_images_visible: c.detail_images_visible })],
                    ] as const).map(([label, on, fn]) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{label}</span>
                        <Switch on={on} onClick={fn} />
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setExpanded(isOpen ? null : c.id)}
                    className={`flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium ${
                      isOpen ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <Images size={14} />
                    {isOpen ? '이미지 관리 닫기' : '상세 이미지 관리'}
                  </button>
                </div>

                {/* 누른 카드 바로 아래에 전체 폭으로 펼친다. 예전엔 표 위쪽에 떠서
                    아래쪽 업체를 누르면 패널이 화면 밖에 생겼다. */}
                {isOpen && (
                  <div className="sm:col-span-2 xl:col-span-3 bg-white rounded-xl border border-pink-300 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Images size={16} className="text-gray-500" />
                      <span className="font-semibold text-gray-900">{c.name}</span>
                      <span className="text-xs text-gray-400">상세 이미지 유형</span>
                    </div>
                    <CompanyImageTypes companyId={c.id} slug={c.slug} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
