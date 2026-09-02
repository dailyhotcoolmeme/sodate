import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, uploadBannerImage, deleteDetailImage } from '../lib/supabase'
import { Plus, Trash2, ChevronUp, ChevronDown, Upload, AlertTriangle } from 'lucide-react'

/**
 * 메뉴 상단 배너 관리(2026-09-02 오너 지시) — 제휴 관리 화면의 '배너' 탭.
 *
 * 스위치가 두 겹이다:
 *   · 메뉴 스위치(banner_settings.enabled) — 그 메뉴의 배너를 통째로 끈다.
 *     배너가 0장이어도 스위치는 있어야 해서 banners 안에 못 둔다.
 *   · 배너 스위치(banners.is_active)      — 한 장씩 끈다. 지웠다 다시 올릴 필요 없이.
 *
 * 순서는 sort_order 로, ▲▼ 로 옆 배너와 값을 맞바꾼다. 드래그는 쓰지 않는다 —
 * 한 메뉴에 5장 권장이라 굳이 필요 없고, 모바일 admin 에서 드래그는 잘 안 잡힌다.
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

const TARGET_TYPES = [
  { key: 'url', label: '외부 주소' },
  { key: 'event', label: '앱 — 일정' },
  { key: 'company', label: '앱 — 업체' },
  { key: 'place', label: '앱 — 혼술바' },
  { key: 'none', label: '링크 없음' },
] as const

interface Banner {
  id: string
  menu: BannerMenu
  image_url: string
  target_type: string
  target_value: string | null
  sort_order: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
  memo: string | null
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

export default function BannerManager() {
  const [menu, setMenu] = useState<BannerMenu>('dating')
  const [banners, setBanners] = useState<Banner[]>([])
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const [b, s] = await Promise.all([
      supabase.from('banners').select('*').order('menu').order('sort_order'),
      supabase.from('banner_settings').select('*'),
    ])
    if (b.error) setErr(b.error.message)
    if (s.error) setErr(s.error.message)
    setBanners((b.data as any) ?? [])
    const map: Record<string, boolean> = {}
    for (const row of ((s.data as any[]) ?? [])) map[row.menu] = row.enabled
    setEnabled(map)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const list = useMemo(
    () => banners.filter((b) => b.menu === menu).sort((a, b) => a.sort_order - b.sort_order),
    [banners, menu]
  )

  // 저장 실패를 조용히 넘기지 않는다 — 화면만 바뀌고 DB 는 그대로인 게 제일 나쁘다.
  async function patch(id: string, p: Partial<Banner>, revert: Partial<Banner>) {
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
    if (error) {
      setEnabled((p) => ({ ...p, [menu]: !next }))
      setErr(`저장 실패: ${error.message}`)
    }
  }

  async function addBanner(file: File) {
    if (list.length >= MAX_PER_MENU) {
      setErr(`한 메뉴에 배너는 ${MAX_PER_MENU}장까지입니다. 쓰지 않는 배너를 먼저 지워주세요.`)
      return
    }
    setUploading(true)
    setErr(null)
    try {
      const url = await uploadBannerImage(file)
      const { error } = await supabase.from('banners').insert({
        menu,
        image_url: url,
        target_type: 'url',
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
    // 행을 지운 뒤에 R2 원본도 지운다 — 순서가 반대면 행은 남고 이미지만 사라져
    // 앱에서 깨진 배너가 뜬다. 이미지 삭제가 실패해도 목록은 이미 정리된 상태다.
    deleteDetailImage(b.image_url).catch(() => {})
    await load()
  }

  /** ▲▼ — 옆 배너와 sort_order 를 맞바꾼다. */
  async function move(b: Banner, dir: -1 | 1) {
    const i = list.findIndex((x) => x.id === b.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const other = list[j]
    setBanners((prev) =>
      prev.map((x) =>
        x.id === b.id ? { ...x, sort_order: other.sort_order }
        : x.id === other.id ? { ...x, sort_order: b.sort_order } : x
      )
    )
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
              key={m.key}
              onClick={() => setMenu(m.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold border ${
                menu === m.key
                  ? 'bg-pink-500 border-pink-500 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:text-gray-700'
              }`}
            >
              {m.label} {count > 0 && <span className="tabular-nums opacity-80">{count}</span>}
            </button>
          )
        })}
      </div>

      {/* 메뉴 스위치 */}
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

      {!loading && list.length === 0 && (
        <p className="text-sm text-gray-400">등록된 배너가 없습니다.</p>
      )}

      {list.map((b, i) => (
        <div key={b.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* 미리보기 — 앱과 같은 4:1 비율로 보여준다 */}
          <img src={b.image_url} alt="" className="w-full aspect-[1110/276] object-cover bg-gray-100" />

          <div className="px-4 py-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                defaultValue={b.memo ?? ''}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== (b.memo ?? null)) patch(b.id, { memo: v }, { memo: b.memo })
                }}
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
              <Switch on={b.is_active} onClick={() => patch(b.id, { is_active: !b.is_active }, { is_active: b.is_active })} />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={b.target_type}
                onChange={(e) => patch(b.id, { target_type: e.target.value }, { target_type: b.target_type })}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
              >
                {TARGET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              {b.target_type !== 'none' && (
                <input
                  defaultValue={b.target_value ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null
                    if (v !== (b.target_value ?? null)) patch(b.id, { target_value: v }, { target_value: b.target_value })
                  }}
                  placeholder={b.target_type === 'url' ? 'https://…' : '앱 화면 id'}
                  className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1 text-sm"
                />
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-500">시작</label>
              <input type="date" value={b.starts_at ?? ''}
                onChange={(e) => patch(b.id, { starts_at: e.target.value || null }, { starts_at: b.starts_at })}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
              <label className="text-xs text-gray-500">종료</label>
              <input type="date" value={b.ends_at ?? ''}
                onChange={(e) => patch(b.id, { ends_at: e.target.value || null }, { ends_at: b.ends_at })}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
              <span className="text-[11px] text-gray-400">비우면 제한 없음</span>
              <button onClick={() => removeBanner(b)}
                className="ml-auto flex items-center gap-1 text-sm text-red-500 hover:text-red-600">
                <Trash2 size={14} /> 삭제
              </button>
            </div>
          </div>
        </div>
      ))}

      {!loading && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addBanner(f) }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || list.length >= MAX_PER_MENU}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm font-bold text-gray-500 hover:border-pink-400 hover:text-pink-600 disabled:opacity-40"
          >
            {uploading ? <><Upload size={16} /> 올리는 중…</> : <><Plus size={16} /> 배너 등록</>}
          </button>
          <p className="mt-2 text-[11px] text-gray-400 leading-relaxed">
            규격 <b>1110 × 276 (4:1)</b> · 한 메뉴 최대 {MAX_PER_MENU}장 (현재 {list.length}장)<br />
            ⚠️ 이미지에 둥근 모서리를 굽지 마세요 — 앱이 자르는 값과 어긋나 다크모드에서 네 귀퉁이에 흰 선이 남습니다.
          </p>
        </div>
      )}
    </div>
  )
}
