import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, Search, Handshake } from 'lucide-react'
import BannerManager from '../components/BannerManager'

/**
 * 제휴 관리 — '모잇 할인' 딱지를 켜고 끄는 곳(2026-09-02 오너 지시).
 *
 * 소개팅·소셜링(companies)과 혼술바(places)는 규칙이 다르다:
 *
 * - **소개팅·소셜링**: 켜고 끄기만. 기간을 두지 않는다 — 일정 자체가 날짜가 지나면
 *   피드에서 사라지므로 기간 관리가 따로 필요 없다(오너 판단).
 * - **혼술바**: 매장은 상시 노출이라 기간이 필요하다. 시작·종료일을 넣으면 앱은
 *   오늘이 그 사이일 때만 딱지를 그린다(app/lib/partner.ts).
 *
 * 업체는 17곳뿐이라 전부 펼쳐 보여주고, 혼술바는 500곳이라 **제휴 중인 곳만 항상
 * 보여주고 나머지는 검색으로 찾는다** — 500줄을 훑어 한 곳을 켜는 화면은 못 쓴다.
 *
 * 배너 관리도 이 화면에 들어올 예정이다(오너 지시). 지금은 만들지 않았으므로 빈 탭을
 * 두지 않는다 — 눌러서 아무것도 없는 탭은 고장으로 읽힌다. 붙일 때 TABS 에 추가한다.
 */

interface Company {
  id: string
  name: string
  slug: string
  plan: string
  partner_benefit: string | null
  app_visible: boolean
}

interface Place {
  id: string
  name: string
  region: string | null
  category: string | null
  plan: string
  plan_starts_at: string | null
  plan_ends_at: string | null
  partner_benefit: string | null
}

const TABS = [
  { key: 'company', label: '소개팅·소셜링 업체' },
  { key: 'place', label: '혼술바' },
  { key: 'banner', label: '배너' },
] as const
type TabKey = (typeof TABS)[number]['key']

/** 오늘(KST) 'YYYY-MM-DD' — 앱과 같은 기준으로 '지금 딱지가 보이는가'를 판정한다. */
function todayKST(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60 + 9 * 3600) * 1000)
  return `${kst.getFullYear()}-${`${kst.getMonth() + 1}`.padStart(2, '0')}-${`${kst.getDate()}`.padStart(2, '0')}`
}

/** 이 매장이 지금 앱에서 딱지가 보이는 상태인가(기간까지 반영). */
function placeLive(p: Place): boolean {
  if (p.plan !== 'partner') return false
  const t = todayKST()
  if (p.plan_starts_at && t < p.plan_starts_at) return false
  if (p.plan_ends_at && t > p.plan_ends_at) return false
  return true
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? 'bg-pink-500' : 'bg-gray-200'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

/**
 * 혜택 문구 입력칸.
 *
 * 글자를 칠 때마다 저장하면 한 글자에 한 번씩 DB 를 때린다 → **입력칸을 벗어날 때
 * (blur) 한 번만** 저장한다. 값이 그대로면 저장 자체를 건너뛴다.
 * 비워두면 null 로 저장되고, 앱 팝업에서 혜택 줄이 통째로 빠진다(오너 지시).
 */
function BenefitInput({
  value, placeholder, onSave,
}: {
  value: string | null
  placeholder: string
  onSave: (v: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')
  // 다른 곳에서 값이 바뀌면(저장 실패 되돌림 등) 입력칸도 따라간다.
  useEffect(() => { setDraft(value ?? '') }, [value])
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 shrink-0">혜택</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft.trim() || null
          if (next !== (value ?? null)) onSave(next)
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
      />
    </div>
  )
}

/** 앱에 그려지는 것과 같은 딱지 — 켰을 때 뭐가 보이는지 여기서 바로 확인하려고. */
function BadgePreview() {
  return (
    <span className="shrink-0 bg-pink-500 text-white text-[11px] font-extrabold rounded-md px-1.5 py-0.5 leading-none">
      모잇 할인
    </span>
  )
}

export default function Partners() {
  const [tab, setTab] = useState<TabKey>('company')
  const [companies, setCompanies] = useState<Company[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    async function load() {
      // PostgREST 는 한 번에 1000행까지만 준다. 혼술바가 500곳이라 아직 여유가 있지만
      // 넘는 순간 뒤쪽 매장이 조용히 사라지므로 처음부터 끝까지 나눠 받는다.
      const PAGE = 1000
      const rows: Place[] = []
      for (let from = 0; ; from += PAGE) {
        const res = await supabase
          .from('places')
          .select('id,name,region,category,plan,plan_starts_at,plan_ends_at,partner_benefit')
          .eq('service', 'honsul')
          .eq('is_active', true)
          .order('name')
          .range(from, from + PAGE - 1)
        if (res.error) { setErr(res.error.message); break }
        rows.push(...((res.data as any) ?? []))
        if (!res.data || res.data.length < PAGE) break
      }
      const co = await supabase.from('companies').select('id,name,slug,plan,partner_benefit,app_visible').order('name')
      if (co.error) setErr(co.error.message)
      setCompanies((co.data as any) ?? [])
      setPlaces(rows)
      setLoading(false)
    }
    load()
  }, [])

  // 저장 실패를 조용히 넘기지 않는다 — 화면만 바뀌고 DB 는 그대로인 상태가 제일 나쁘다.
  async function patchCompany(id: string, patch: Partial<Company>, revert: Partial<Company>) {
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    const { error } = await supabase.from('companies').update(patch).eq('id', id)
    if (error) {
      setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, ...revert } : c)))
      setErr(`저장 실패: ${error.message}`)
    }
  }

  async function patchPlace(id: string, patch: Partial<Place>, revert: Partial<Place>) {
    setPlaces((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('places').update(patch).eq('id', id)
    if (error) {
      setPlaces((prev) => prev.map((p) => (p.id === id ? { ...p, ...revert } : p)))
      setErr(`저장 실패: ${error.message}`)
    }
  }

  const partnerCompanies = companies.filter((c) => c.plan === 'partner')
  const partnerPlaces = places.filter((p) => p.plan === 'partner')

  // 혼술바는 제휴 중인 곳을 항상 위에 보여주고, 검색어가 있을 때만 나머지를 붙인다.
  const searched = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    return places.filter((p) => p.plan !== 'partner' && p.name.includes(s)).slice(0, 30)
  }, [q, places])

  return (
    <div className="p-4 md:p-8 space-y-4">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">제휴 관리</h1>
        {tab !== 'banner' && (
          <span className="text-sm text-gray-400">
            업체 {partnerCompanies.length}곳 · 혼술바 {partnerPlaces.length}곳
          </span>
        )}
      </div>

      {tab !== 'banner' && (
      <p className="text-sm text-gray-500">
        켜면 앱의 일정 제목·매장명 앞에 <BadgePreview /> 딱지가 붙고,
        상세 화면에 들어올 때 혜택 안내 팝업이 뜹니다. 혜택 칸을 비우면 팝업에서 혜택 줄만 빠집니다.
      </p>
      )}

      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{err}</p>
          <button onClick={() => setErr(null)} className="text-xs text-red-400 hover:text-red-600">닫기</button>
        </div>
      )}

      {/* 좁은 화면에서 탭 글자가 두 줄로 쪼개지지 않게 — 한 줄 고정 + 가로 스크롤 */}
      <div className="tab-scroll flex items-center gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${
              tab === t.key ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'banner' && <BannerManager />}

      {loading && tab !== 'banner' && <p className="text-sm text-gray-400">불러오는 중…</p>}

      {/* ── 소개팅·소셜링 업체 — 17곳뿐이라 전부 보여준다 ── */}
      {!loading && tab === 'company' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            제휴 기간은 두지 않습니다 — 일정은 날짜가 지나면 피드에서 저절로 사라집니다.
          </p>
          {companies.map((c) => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {c.plan === 'partner' && <BadgePreview />}
                <span className="font-semibold text-gray-900 truncate">{c.name}</span>
                {!c.app_visible && (
                  <span className="shrink-0 text-[11px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
                    앱 숨김
                  </span>
                )}
              </div>
              <Switch
                on={c.plan === 'partner'}
                onClick={() =>
                  patchCompany(
                    c.id,
                    { plan: c.plan === 'partner' ? 'free' : 'partner' },
                    { plan: c.plan }
                  )
                }
              />
              </div>
              {c.plan === 'partner' && (
                <BenefitInput
                  value={c.partner_benefit}
                  placeholder="예: 5,000원 할인 (비우면 팝업에 혜택 줄 없음)"
                  onSave={(v) => patchCompany(c.id, { partner_benefit: v }, { partner_benefit: c.partner_benefit })}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 혼술바 — 제휴 중인 곳 + 검색으로 추가 ── */}
      {!loading && tab === 'place' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900 mb-2">제휴 중 {partnerPlaces.length}곳</h2>
            {partnerPlaces.length === 0 ? (
              <p className="text-sm text-gray-400">아직 없습니다. 아래에서 매장을 찾아 켜주세요.</p>
            ) : (
              <div className="space-y-2">
                {partnerPlaces.map((p) => (
                  <div key={p.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <BadgePreview />
                        <span className="font-semibold text-gray-900 truncate">{p.name}</span>
                        <span className="shrink-0 text-xs text-gray-400">{p.region}</span>
                      </div>
                      <Switch
                        on
                        onClick={() =>
                          patchPlace(
                            p.id,
                            { plan: 'free' },
                            { plan: 'partner' }
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-xs text-gray-500">시작</label>
                      <input
                        type="date"
                        value={p.plan_starts_at ?? ''}
                        onChange={(e) =>
                          patchPlace(p.id, { plan_starts_at: e.target.value || null }, { plan_starts_at: p.plan_starts_at })
                        }
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                      />
                      <label className="text-xs text-gray-500">종료</label>
                      <input
                        type="date"
                        value={p.plan_ends_at ?? ''}
                        onChange={(e) =>
                          patchPlace(p.id, { plan_ends_at: e.target.value || null }, { plan_ends_at: p.plan_ends_at })
                        }
                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                      />
                      {/* 켜뒀는데 기간 때문에 앱에서 안 보이는 상태를 여기서 바로 알려준다 —
                          이걸 안 보여주면 "켰는데 왜 안 나오냐"로 시간을 버린다. */}
                      {placeLive(p) ? (
                        <span className="text-xs text-green-600 font-semibold">앱에 표시 중</span>
                      ) : (
                        <span className="text-xs text-orange-600 font-semibold">
                          기간 밖 — 지금은 앱에 안 보임
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400">비워두면 제한 없음(시작=즉시, 종료=무기한)</p>
                    <BenefitInput
                      value={p.partner_benefit}
                      placeholder="예: 칵테일 1잔 서비스 (비우면 팝업에 혜택 줄 없음)"
                      onSave={(v) => patchPlace(p.id, { partner_benefit: v }, { partner_benefit: p.partner_benefit })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-bold text-gray-900 mb-2">매장 찾기</h2>
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="매장명 검색 (전체 500곳)"
                className="flex-1 min-w-0 text-sm outline-none"
              />
            </div>
            {q.trim() && (
              <div className="mt-2 space-y-2">
                {searched.length === 0 ? (
                  <p className="text-sm text-gray-400">검색 결과가 없습니다.</p>
                ) : (
                  searched.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-gray-900 truncate">{p.name}</span>
                        <span className="ml-2 text-xs text-gray-400">{p.region} · {p.category}</span>
                      </div>
                      <button
                        onClick={() => patchPlace(p.id, { plan: 'partner' }, { plan: 'free' })}
                        className="shrink-0 flex items-center gap-1.5 bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold rounded-lg px-3 py-1.5"
                      >
                        <Handshake size={15} />
                        제휴 켜기
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
