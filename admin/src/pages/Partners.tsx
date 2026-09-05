import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, Search, Handshake, Link as LinkIcon, Plus } from 'lucide-react'
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
  partner_tier: string | null
  partner_benefit: string | null
  socials: Record<string, string> | null
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
  socials: Record<string, string> | null
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
      <label className="text-xs text-gray-500 shrink-0">앱에 띄울 혜택 문구</label>
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

/** 무료/유료 — 유료 제휴처만 제휴 포털에서 배너 광고 메뉴가 보인다(2026-09-05 확정). */
function TierSelect({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <select
      value={value ?? 'free'}
      onChange={(e) => onChange(e.target.value)}
      className="border border-gray-200 rounded-lg px-2 py-1 text-xs font-semibold text-gray-700"
    >
      <option value="free">무료 제휴</option>
      <option value="paid">유료 제휴</option>
    </select>
  )
}

interface PartnerAccountStatus {
  email: string
  status: 'active' | 'disabled'
  pending: boolean
  lastLoginAt: string | null
}

/**
 * 제휴 포털 초대 위젯(2026-09-05 신설).
 *
 * 아직 초대 안 한 업체 → 이메일 입력 + "초대 보내기".
 * 이미 초대했지만 비번 미설정 → "초대됨 · 가입 대기" + 초대 메일 다시 보내기.
 * 쓰는 중(active) → "가입 완료" + 정지 버튼.
 * 정지(disabled) → "로그인 막음" + 재개 버튼.
 */
function PartnerInvite({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<PartnerAccountStatus | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () =>
    fetch(`/api/partner-status?companyId=${companyId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setStatus(d.account ?? null))
      .catch(() => setStatus(null))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const sendInvite = async () => {
    const target = status?.email || email.trim()
    if (!target) return
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/partner-invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, email: target }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(`메일을 못 보냈습니다: ${data.error ?? '알 수 없는 오류'}`)
      } else if (data.mailSent) {
        setMsg('초대 메일을 보냈습니다. 그쪽에서 비밀번호를 정하면 바로 쓸 수 있습니다.')
        await load()
      } else {
        setMsg(`메일만 못 나갔고 계정은 만들어졌습니다. 아래 주소를 그쪽에 직접 전달해주세요: ${data.inviteUrl}`)
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleStatus = async () => {
    if (!status) return
    const next = status.status === 'active' ? 'disabled' : 'active'
    setBusy(true)
    try {
      await fetch('/api/partner-status', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, status: next }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (status === undefined) return <p className="text-xs text-gray-400">제휴 포털 계정 확인 중…</p>

  return (
    <div className="border-t border-gray-100 pt-2">
      <p className="text-xs font-semibold text-gray-600 mb-1.5">
        제휴 포털 로그인 계정
      </p>
      {!status ? (
        <div className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이 제휴처 담당자 이메일"
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
          />
          <button
            onClick={sendInvite}
            disabled={busy || !email.trim()}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400"
          >
            초대 메일 보내기
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-600">{status.email}</span>
          {status.pending ? (
            <span className="text-[11px] font-semibold text-amber-600 border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5">
              메일 보냄 · 비밀번호 설정 전
            </span>
          ) : status.status === 'active' ? (
            <span className="text-[11px] font-semibold text-green-600 border border-green-200 bg-green-50 rounded px-1.5 py-0.5">
              가입 완료
            </span>
          ) : (
            <span className="text-[11px] font-semibold text-gray-500 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5">
              정지됨
            </span>
          )}
          <button
            onClick={sendInvite}
            disabled={busy}
            className="text-xs font-semibold text-pink-600 hover:underline"
          >
            재초대
          </button>
          {!status.pending && (
            <button onClick={toggleStatus} disabled={busy} className="text-xs font-semibold text-gray-500 hover:underline">
              {status.status === 'active' ? '로그인 막기' : '다시 열어주기'}
            </button>
          )}
        </div>
      )}
      {msg && <p className="text-[11px] text-gray-500 mt-1 break-all">{msg}</p>}
    </div>
  )
}

/**
 * 목록에 «없는» 제휴처를 새로 만들며 바로 초대한다.
 *
 * 왜 필요한가(2026-09-05 오너 지적): 문토·프립 같은 모임 플랫폼은 업체 목록에서 한 줄이
 * 플랫폼 전체다. 그 안에서 모임을 여는 개별 호스트는 목록에 아예 없어서 초대를 걸 대상이
 * 없었다. 여기서 호스트마다 새 줄을 만들어 초대한다.
 * 크롤링은 안 붙으므로 문토·프립 쪽 수집 데이터는 그대로 남는다.
 */
function NewPartnerInvite({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [tier, setTier] = useState('free')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const res = await fetch('/api/partner-company', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), tier }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErr(
          data.error === 'name_taken'
            ? '같은 이름이 목록에 이미 있습니다. 그 줄에서 초대해주세요.'
            : data.error === 'invalid_email'
              ? '이메일 주소를 다시 확인해주세요.'
              : data.error === 'missing_name'
                ? '제휴처 이름을 적어주세요.'
                : '만들지 못했습니다. 잠시 후 다시 시도해주세요.',
        )
        return
      }
      setMsg(
        data.mailSent
          ? `'${name.trim()}' 을(를) 만들고 초대 메일을 보냈습니다.`
          : `'${name.trim()}' 은(는) 만들어졌지만 메일이 안 나갔습니다. 아래 줄에서 다시 초대해주세요.`,
      )
      setName('')
      setEmail('')
      setOpen(false)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-1.5">
        <button
          onClick={() => {
            setOpen(true)
            setMsg('')
          }}
          className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold text-white bg-pink-500 hover:bg-pink-600"
        >
          <Plus size={15} />
          목록에 없는 제휴처 초대하기
        </button>
        <p className="text-xs text-gray-400">
          문토·프립처럼 여러 호스트가 모여 있는 곳에서 «한 호스트»만 제휴할 때 씁니다. 새 줄이 하나
          생기고, 문토·프립 쪽 수집 일정은 그대로 둡니다.
        </p>
        {msg && <p className="text-xs text-green-600">{msg}</p>}
      </div>
    )
  }

  return (
    <div className="bg-white border border-pink-200 rounded-xl px-4 py-3.5 space-y-3">
      <p className="text-sm font-bold text-gray-900">목록에 없는 제휴처 초대하기</p>
      <div>
        <label className="block text-xs text-gray-500 mb-1">제휴처 이름</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 밀크티타카 (앱에 그대로 보이는 이름)"
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">담당자 이메일</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="host@example.com"
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm"
        />
        <p className="text-xs text-gray-400 mt-1">이 주소로 초대 메일이 나가고, 이게 로그인 아이디가 됩니다.</p>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 shrink-0">제휴 종류</label>
        <TierSelect value={tier} onChange={setTier} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !name.trim() || !email.trim()}
          className="rounded-lg px-3.5 py-2 text-sm font-bold text-white bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {busy ? '만드는 중…' : '만들고 초대 메일 보내기'}
        </button>
        <button
          onClick={() => {
            setOpen(false)
            setErr('')
          }}
          className="rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50"
        >
          취소
        </button>
      </div>
    </div>
  )
}

const SOCIAL_FIELDS: { key: string; label: string; ph: string }[] = [
  { key: 'homepage',  label: '홈페이지',    ph: 'https://…' },
  { key: 'instagram', label: '인스타그램',  ph: 'https://instagram.com/…' },
  { key: 'youtube',   label: '유튜브',      ph: 'https://youtube.com/@…' },
  { key: 'blog',      label: '블로그',      ph: 'https://blog.naver.com/…' },
  { key: 'facebook',  label: '페이스북',    ph: 'https://facebook.com/…' },
  { key: 'threads',   label: '스레드',      ph: 'https://threads.net/@…' },
  { key: 'tiktok',    label: '틱톡',        ph: 'https://tiktok.com/@…' },
  { key: 'x',         label: 'X',           ph: 'https://x.com/…' },
  { key: 'kakao',     label: '카카오채널',  ph: 'https://pf.kakao.com/…' },
]

/**
 * 홈페이지·SNS 주소 편집(2026-09-02 오너 지시).
 * 여기 채운 것만 앱의 업체명 밑에 **아이콘으로** 뜬다 — 안 채우면 아이콘이 안 생긴다.
 * 접어 두는 이유: 9칸을 늘 펼쳐 두면 카드가 화면을 다 먹는다. 채운 개수를 접힌 줄에 보여준다.
 */
function SocialEditor({
  value, onSave,
}: {
  value: Record<string, string> | null
  onSave: (v: Record<string, string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>(value ?? {})
  useEffect(() => { setDraft(value ?? {}) }, [value])
  const filled = Object.values(value ?? {}).filter((v) => (v ?? '').trim()).length
  const dirty = JSON.stringify(draft) !== JSON.stringify(value ?? {})
  return (
    <div className="border-t border-gray-100 pt-2">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
        <LinkIcon size={14} />
        <span className="font-semibold">홈페이지·SNS</span>
        <span className="text-xs text-gray-400">{filled > 0 ? `${filled}개 등록됨` : '없음'}</span>
        <span className="text-xs text-gray-400">{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {SOCIAL_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-xs text-gray-500">{f.label}</label>
              <input
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.ph}
                className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
              />
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <button
              onClick={() => {
                // 빈 칸은 아예 저장하지 않는다 — 빈 문자열이 남으면 앱에서 "등록됨"으로 세어진다.
                const clean: Record<string, string> = {}
                for (const [k, v] of Object.entries(draft)) if ((v ?? '').trim()) clean[k] = v.trim()
                onSave(clean)
              }}
              disabled={!dirty}
              className="rounded-lg px-4 py-1.5 text-sm font-bold text-white bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400"
            >
              {dirty ? '저장' : '저장됨'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Partners() {
  const [tab, setTab] = useState<TabKey>('company')
  const [companies, setCompanies] = useState<Company[]>([])
  const [places, setPlaces] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')

  // 새 제휴처를 만든 뒤 목록을 다시 읽는 데도 쓰므로 밖에 둔다.
  const reloadCompanies = useCallback(async () => {
    const co = await supabase
      .from('companies')
      .select('id,name,slug,plan,partner_tier,partner_benefit,socials,app_visible')
      .order('name')
    if (co.error) setErr(co.error.message)
    else setCompanies((co.data as any) ?? [])
  }, [])

  useEffect(() => {
    async function load() {
      // PostgREST 는 한 번에 1000행까지만 준다. 혼술바가 500곳이라 아직 여유가 있지만
      // 넘는 순간 뒤쪽 매장이 조용히 사라지므로 처음부터 끝까지 나눠 받는다.
      const PAGE = 1000
      const rows: Place[] = []
      for (let from = 0; ; from += PAGE) {
        const res = await supabase
          .from('places')
          .select('id,name,region,category,plan,plan_starts_at,plan_ends_at,partner_benefit,socials')
          .eq('service', 'honsul')
          .eq('is_active', true)
          .order('name')
          .range(from, from + PAGE - 1)
        if (res.error) { setErr(res.error.message); break }
        rows.push(...((res.data as any) ?? []))
        if (!res.data || res.data.length < PAGE) break
      }
      const co = await supabase.from('companies').select('id,name,slug,plan,partner_tier,partner_benefit,socials,app_visible').order('name')
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
        <h1 className="text-xl font-bold text-gray-900">모잇 Pick!</h1>
        {tab !== 'banner' && (
          <span className="text-sm text-gray-400">
            제휴 중인 업체 {partnerCompanies.length}곳 · 혼술바 {partnerPlaces.length}곳
          </span>
        )}
      </div>

      {tab !== 'banner' && (
      <p className="text-sm text-gray-500">
        스위치를 켜면 그 업체가 «제휴처»가 됩니다. 앱에서 일정 제목·매장명 앞에 <BadgePreview /> 딱지가
        붙고, 이용자가 상세 화면에 들어올 때 혜택 안내 팝업이 뜹니다. 혜택 문구를 비워두면 팝업에서 그
        줄만 빠집니다. 제휴처로 켜야 아래에 제휴 포털 초대 칸이 나옵니다.
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
          <NewPartnerInvite onCreated={reloadCompanies} />
          <p className="text-xs text-gray-400 pt-2">
            제휴 기간은 따로 두지 않습니다 — 일정은 날짜가 지나면 앱에서 저절로 사라집니다.
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
                <>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 shrink-0">제휴 종류</label>
                    <TierSelect
                      value={c.partner_tier}
                      onChange={(v) => patchCompany(c.id, { partner_tier: v }, { partner_tier: c.partner_tier })}
                    />
                    <span className="text-[11px] text-gray-400">유료로 두면 제휴 포털에 &apos;배너 광고&apos; 메뉴가 하나 더 생깁니다</span>
                  </div>
                  <BenefitInput
                    value={c.partner_benefit}
                    placeholder="예: 5,000원 할인 (비우면 팝업에 혜택 줄 없음)"
                    onSave={(v) => patchCompany(c.id, { partner_benefit: v }, { partner_benefit: c.partner_benefit })}
                  />
                  <SocialEditor
                    value={c.socials}
                    onSave={(v) => patchCompany(c.id, { socials: v }, { socials: c.socials })}
                  />
                  <PartnerInvite companyId={c.id} />
                </>
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
                    <SocialEditor
                      value={p.socials}
                      onSave={(v) => patchPlace(p.id, { socials: v }, { socials: p.socials })}
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
