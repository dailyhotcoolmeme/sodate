import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, uploadBannerImage, deleteDetailImage } from '../lib/supabase'
import { Plus, Trash2, ChevronUp, ChevronDown, Upload, AlertTriangle, Search, X } from 'lucide-react'

/**
 * 메뉴 상단 배너 관리(2026-09-02 오너 지시) — 제휴 관리 화면의 '배너' 탭.
 *
 * 스위치가 두 겹이다:
 *   · 메뉴 스위치(banner_settings.enabled) — 그 메뉴의 배너를 통째로 끈다.
 *     배너가 0장이어도 스위치는 있어야 해서 banners 안에 못 둔다.
 *   · 배너 스위치(banners.is_active)      — 한 장씩 끈다. 지웠다 다시 올릴 필요 없이.
 *
 * ## 즉시 반영과 '저장' 버튼을 나눈 기준
 * 스위치·순서·삭제는 **동작**이라 누르는 즉시 반영한다(누르고 저장까지 눌러야 하면 이상하다).
 * 메모·링크·기간은 **편집**이라 초안으로 모아 뒀다가 [저장]을 눌러야 들어간다 —
 * 처음엔 입력칸을 벗어날 때 자동 저장했는데, 저장됐는지 알 수가 없다는 지적을 받았다
 * (2026-09-02 오너: "여기는 저장 버튼이 있어야 할 거 같은데").
 *
 * ## 링크 대상은 이름으로 고른다
 * 처음엔 UUID 를 직접 붙여넣게 만들었는데 오너가 그 id 를 알 방법이 없다 — 설계 잘못이었다.
 * 이제 이름으로 검색해 고른다. 업체(17곳)는 통째로 받아 두고, 혼술바(500곳)도 한 번에
 * 받아 화면에서 거른다. 일정은 **3,500건이 넘어** 다 받을 수 없어서 서버에 검색을 맡긴다.
 */

export const BANNER_MENUS = [
  { key: 'dating', label: '소개팅' },
  { key: 'socialing', label: '소셜링' },
  { key: 'honsul', label: '혼술바' },
  { key: 'board', label: '커뮤니티' },
] as const
export type BannerMenu = (typeof BANNER_MENUS)[number]['key']

/** 한 메뉴에 이보다 많이 두면 뒤쪽은 아무도 안 본다(오너 확정). */
const MAX_PER_MENU = 5

type TargetType = 'url' | 'event' | 'company' | 'place' | 'none'
const TARGET_TYPES: { key: TargetType; label: string }[] = [
  { key: 'url', label: '외부 주소' },
  { key: 'event', label: '앱 — 일정' },
  { key: 'company', label: '앱 — 업체' },
  { key: 'place', label: '앱 — 혼술바' },
  { key: 'none', label: '링크 없음' },
]

interface Banner {
  id: string
  menu: BannerMenu
  image_url: string
  target_type: TargetType
  target_value: string | null
  sort_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  memo: string | null
}

/** 저장 버튼으로 한 번에 반영하는 편집 항목들. */
type Draft = Pick<Banner, 'memo' | 'target_type' | 'target_value' | 'starts_at' | 'ends_at'>
const draftOf = (b: Banner): Draft => ({
  memo: b.memo, target_type: b.target_type, target_value: b.target_value,
  starts_at: b.starts_at, ends_at: b.ends_at,
})
const sameDraft = (a: Draft, b: Draft) =>
  a.memo === b.memo && a.target_type === b.target_type && a.target_value === b.target_value &&
  a.starts_at === b.starts_at && a.ends_at === b.ends_at

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={onClick}
      className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? 'bg-pink-500' : 'bg-gray-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

type Opt = { id: string; label: string; sub?: string }

/**
 * 앱 내부 화면(일정·업체·혼술바)을 **이름으로** 고르는 칸.
 * 고른 뒤에는 이름을 보여주고, id 는 뒤에서만 오간다.
 */
function TargetPicker({
  type, value, label, onPick, onLabel,
}: {
  type: Exclude<TargetType, 'url' | 'none'>
  value: string | null
  label: string | null
  onPick: (id: string) => void
  onLabel: (id: string, label: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState<Opt[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      setBusy(true)
      if (type === 'company') {
        const { data } = await supabase.from('companies').select('id,name').order('name')
        if (alive) setOpts(((data as any[]) ?? []).map((c) => ({ id: c.id, label: c.name })))
      } else if (type === 'place') {
        const { data } = await supabase
          .from('places').select('id,name,region').eq('service', 'honsul').eq('is_active', true).order('name')
        if (alive) setOpts(((data as any[]) ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.region ?? '' })))
      } else {
        // 일정은 3,500건이 넘어 다 못 받는다 → 두 글자부터 서버에 검색을 맡긴다.
        if (q.trim().length < 2) { setOpts([]); setBusy(false); return }
        const { data } = await supabase
          .from('events')
          .select('id,title,event_date,location_region')
          .eq('is_active', true)
          .gte('event_date', new Date().toISOString())
          .ilike('title', `%${q.trim()}%`)
          .order('event_date')
          .limit(30)
        if (alive) setOpts(((data as any[]) ?? []).map((e) => ({
          id: e.id, label: e.title,
          sub: `${(e.event_date ?? '').slice(5, 10)} · ${e.location_region ?? ''}`,
        })))
      }
      if (alive) setBusy(false)
    })()
    return () => { alive = false }
  }, [open, type, q])

  const shown = useMemo(() => {
    if (type === 'event') return opts
    const s = q.trim()
    return (s ? opts.filter((o) => o.label.includes(s)) : opts).slice(0, 30)
  }, [opts, q, type])

  return (
    <div className="flex-1 min-w-0">
      {!open ? (
        <div className="flex items-center gap-2">
          <span className={`flex-1 min-w-0 truncate text-sm ${value ? 'text-gray-900 font-semibold' : 'text-gray-400'}`}>
            {value ? (label ?? '(이름 확인 중…)') : '아직 안 골랐습니다'}
          </span>
          <button onClick={() => { setQ(''); setOpen(true) }}
            className="shrink-0 text-sm font-bold text-pink-600 hover:text-pink-700">
            {value ? '변경' : '고르기'}
          </button>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg p-2 space-y-2 bg-gray-50">
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-2 py-1.5">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={type === 'event' ? '일정 제목 검색 (두 글자 이상)' : '이름 검색'}
              className="flex-1 min-w-0 text-sm outline-none"
            />
            <button onClick={() => setOpen(false)} className="shrink-0 text-gray-400 hover:text-gray-600">
              <X size={15} />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto space-y-1">
            {busy && <p className="text-xs text-gray-400 px-1">불러오는 중…</p>}
            {!busy && shown.length === 0 && (
              <p className="text-xs text-gray-400 px-1">
                {type === 'event' && q.trim().length < 2 ? '두 글자 이상 입력해 주세요.' : '결과가 없습니다.'}
              </p>
            )}
            {shown.map((o) => (
              <button
                key={o.id}
                onClick={() => { onPick(o.id); onLabel(o.id, o.label); setOpen(false) }}
                className="w-full text-left bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-pink-400"
              >
                <span className="text-sm font-semibold text-gray-900">{o.label}</span>
                {o.sub && <span className="ml-2 text-xs text-gray-400">{o.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BannerManager() {
  const [menu, setMenu] = useState<BannerMenu>('dating')
  const [banners, setBanners] = useState<Banner[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [labels, setLabels] = useState<Record<string, string>>({})   // 내부 링크 id → 이름
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /** 이미 링크가 걸린 배너들의 대상 이름을 한 번에 받아 온다(카드에 id 대신 이름을 보여주려고). */
  async function resolveLabels(rows: Banner[]) {
    const byType: Record<string, string[]> = { company: [], place: [], event: [] }
    for (const b of rows) {
      if (b.target_value && byType[b.target_type]) byType[b.target_type].push(b.target_value)
    }
    const next: Record<string, string> = {}
    await Promise.all([
      byType.company.length
        ? supabase.from('companies').select('id,name').in('id', byType.company)
            .then(({ data }) => (data as any[])?.forEach((c) => { next[c.id] = c.name }))
        : null,
      byType.place.length
        ? supabase.from('places').select('id,name').in('id', byType.place)
            .then(({ data }) => (data as any[])?.forEach((p) => { next[p.id] = p.name }))
        : null,
      byType.event.length
        ? supabase.from('events').select('id,title').in('id', byType.event)
            .then(({ data }) => (data as any[])?.forEach((e) => { next[e.id] = e.title }))
        : null,
    ])
    setLabels((prev) => ({ ...prev, ...next }))
  }

  async function load() {
    const [b, s] = await Promise.all([
      supabase.from('banners').select('*').order('menu').order('sort_order'),
      supabase.from('banner_settings').select('*'),
    ])
    if (b.error) setErr(b.error.message)
    if (s.error) setErr(s.error.message)
    const rows = ((b.data as any) ?? []) as Banner[]
    setBanners(rows)
    setDrafts(Object.fromEntries(rows.map((r) => [r.id, draftOf(r)])))
    const map: Record<string, boolean> = {}
    for (const row of ((s.data as any[]) ?? [])) map[row.menu] = row.enabled
    setEnabled(map)
    setLoading(false)
    resolveLabels(rows)
  }
  useEffect(() => { load() }, [])

  const list = useMemo(
    () => banners.filter((b) => b.menu === menu).sort((a, b) => a.sort_order - b.sort_order),
    [banners, menu]
  )

  const setDraft = (id: string, p: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }))

  /** 저장 버튼 — 메모·링크·기간을 한 번에 반영한다. */
  async function save(b: Banner) {
    const d = drafts[b.id]
    if (!d || sameDraft(d, draftOf(b))) return
    setSavingId(b.id)
    const { error } = await supabase.from('banners').update(d).eq('id', b.id)
    setSavingId(null)
    if (error) { setErr(`저장 실패: ${error.message}`); return }
    setBanners((prev) => prev.map((x) => (x.id === b.id ? { ...x, ...d } : x)))
  }

  /** 스위치·순서처럼 '동작'인 것들 — 누르는 즉시 반영. 실패하면 되돌린다. */
  async function act(id: string, p: Partial<Banner>, revert: Partial<Banner>) {
    setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, ...p } : b)))
    const { error } = await supabase.from('banners').update(p).eq('id', id)
    if (error) {
      setBanners((prev) => prev.map((b) => (b.id === id ? { ...b, ...revert } : b)))
      setErr(`저장 실패: ${error.message}`)
    }
  }

  async function toggleMenu() {
    const next = !enabled[menu]
    setEnabled((p) => ({ ...p, [menu]: next }))
    const { error } = await supabase.from('banner_settings').update({ enabled: next }).eq('menu', menu)
    if (error) { setEnabled((p) => ({ ...p, [menu]: !next })); setErr(`저장 실패: ${error.message}`) }
  }

  async function addBanner(file: File) {
    if (list.length >= MAX_PER_MENU) {
      setErr(`한 메뉴에 배너는 ${MAX_PER_MENU}장까지입니다. 쓰지 않는 배너를 먼저 지워주세요.`)
      return
    }
    setUploading(true); setErr(null)
    try {
      const url = await uploadBannerImage(file)
      const { error } = await supabase.from('banners').insert({
        menu, image_url: url, target_type: 'url',
        sort_order: list.length ? Math.max(...list.map((b) => b.sort_order)) + 1 : 0,
      })
      if (error) throw new Error(error.message)
      await load()
    } catch (e: any) {
      setErr(`등록 실패: ${e.message ?? e}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeBanner(b: Banner) {
    if (!confirm(`이 배너를 지웁니다.\n${b.memo || '(메모 없음)'}`)) return
    const { error } = await supabase.from('banners').delete().eq('id', b.id)
    if (error) { setErr(`삭제 실패: ${error.message}`); return }
    // 행을 먼저 지운다 — 순서가 반대면 이미지만 사라지고 행이 남아 앱에 깨진 배너가 뜬다.
    deleteDetailImage(b.image_url).catch(() => {})
    await load()
  }

  /** ▲▼ — 옆 배너와 sort_order 를 맞바꾼다. */
  async function move(b: Banner, dir: -1 | 1) {
    const i = list.findIndex((x) => x.id === b.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const other = list[j]
    setBanners((prev) => prev.map((x) =>
      x.id === b.id ? { ...x, sort_order: other.sort_order }
      : x.id === other.id ? { ...x, sort_order: b.sort_order } : x))
    const [r1, r2] = await Promise.all([
      supabase.from('banners').update({ sort_order: other.sort_order }).eq('id', b.id),
      supabase.from('banners').update({ sort_order: b.sort_order }).eq('id', other.id),
    ])
    if (r1.error || r2.error) { setErr('순서 변경 실패'); await load() }
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 flex-1">{err}</p>
          <button onClick={() => setErr(null)} className="text-xs text-red-400 hover:text-red-600">닫기</button>
        </div>
      )}

      {/* 메뉴 전환 — 탭 안의 탭이 되지 않게 칩으로 둔다 */}
      <div className="tab-scroll flex items-center gap-2">
        {BANNER_MENUS.map((m) => {
          const count = banners.filter((b) => b.menu === m.key).length
          return (
            <button
              key={m.key} onClick={() => setMenu(m.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold border ${
                menu === m.key ? 'bg-pink-500 border-pink-500 text-white'
                               : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700'}`}
            >
              {m.label} {count > 0 && <span className="tabular-nums opacity-80">{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">이 메뉴에 배너 노출</p>
          <p className="text-xs text-gray-400">
            끄면 배너가 켜져 있어도 {BANNER_MENUS.find((m) => m.key === menu)?.label} 화면에 아무것도 안 나옵니다.
          </p>
        </div>
        <Switch on={!!enabled[menu]} onClick={toggleMenu} />
      </div>

      {loading && <p className="text-sm text-gray-400">불러오는 중…</p>}
      {!loading && list.length === 0 && <p className="text-sm text-gray-400">등록된 배너가 없습니다.</p>}

      {list.map((b, i) => {
        const d = drafts[b.id] ?? draftOf(b)
        const dirty = !sameDraft(d, draftOf(b))
        return (
          <div key={b.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <img src={b.image_url} alt="" className="w-full aspect-[1110/276] object-cover bg-gray-100" />

            <div className="px-4 py-3 space-y-2.5">
              {/* 메모 · 순서 · 노출 — 순서와 노출은 누르는 즉시 반영된다 */}
              <div className="flex items-center gap-2">
                <input
                  value={d.memo ?? ''}
                  onChange={(e) => setDraft(b.id, { memo: e.target.value || null })}
                  placeholder="메모 (예: 연숲 9월 소개팅) — 사용자에게 안 보임"
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => move(b, -1)} disabled={i === 0}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30">
                    <ChevronUp size={15} />
                  </button>
                  <button onClick={() => move(b, 1)} disabled={i === list.length - 1}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-500 disabled:opacity-30">
                    <ChevronDown size={15} />
                  </button>
                </div>
                <Switch on={b.is_active} onClick={() => act(b.id, { is_active: !b.is_active }, { is_active: b.is_active })} />
              </div>

              {/* 링크 대상 — 앱 내부는 이름으로 고른다 */}
              {/* 세로 가운데 정렬 — items-start 면 셀렉트 박스만 크고 옆 글자·버튼이 위로 붙는다(2026-09-02 오너 지적) */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={d.target_type}
                  onChange={(e) => setDraft(b.id, { target_type: e.target.value as TargetType, target_value: null })}
                  className="shrink-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
                >
                  {TARGET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                {d.target_type === 'url' && (
                  <input
                    value={d.target_value ?? ''}
                    onChange={(e) => setDraft(b.id, { target_value: e.target.value || null })}
                    placeholder="https://…"
                    className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
                  />
                )}
                {(d.target_type === 'company' || d.target_type === 'place' || d.target_type === 'event') && (
                  <TargetPicker
                    type={d.target_type}
                    value={d.target_value}
                    label={d.target_value ? labels[d.target_value] ?? null : null}
                    onPick={(id) => setDraft(b.id, { target_value: id })}
                    onLabel={(id, label) => setLabels((p) => ({ ...p, [id]: label }))}
                  />
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-500">시작</label>
                <input type="date" value={d.starts_at ?? ''}
                  onChange={(e) => setDraft(b.id, { starts_at: e.target.value || null })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
                <label className="text-xs text-gray-500">종료</label>
                <input type="date" value={d.ends_at ?? ''}
                  onChange={(e) => setDraft(b.id, { ends_at: e.target.value || null })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
                <span className="text-[11px] text-gray-400">비우면 제한 없음</span>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button onClick={() => removeBanner(b)}
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600">
                  <Trash2 size={14} /> 삭제
                </button>
                {dirty && (
                  <button onClick={() => setDrafts((p) => ({ ...p, [b.id]: draftOf(b) }))}
                    className="text-sm text-gray-400 hover:text-gray-600">되돌리기</button>
                )}
                <button
                  onClick={() => save(b)}
                  disabled={!dirty || savingId === b.id}
                  className="ml-auto rounded-lg px-5 py-2 text-sm font-bold text-white bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {savingId === b.id ? '저장 중…' : dirty ? '저장' : '저장됨'}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {!loading && (
        <div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addBanner(f) }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || list.length >= MAX_PER_MENU}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm font-bold text-gray-500 hover:border-pink-400 hover:text-pink-600 disabled:opacity-40"
          >
            {uploading ? <><Upload size={16} /> 올리는 중…</> : <><Plus size={16} /> 배너 등록</>}
          </button>
          <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
            규격 <b>1110 × 276 (4:1)</b> · 한 메뉴 최대 {MAX_PER_MENU}장 (현재 {list.length}장)<br />
            ⚠️ 이미지에 둥근 모서리를 굽지 마세요 — 앱이 자르는 값과 어긋나 다크모드에서 네 귀퉁이에 흰 선이 남습니다.<br />
            ⚠️ <b>오른쪽 아래 모서리는 비워 두세요</b> — 앱이 그 자리에 광고 표시(Ad)를 자동으로 얹습니다.
          </p>
        </div>
      )}
    </div>
  )
}
