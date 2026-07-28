import { useEffect, useRef, useState } from 'react'
import { supabase, uploadDetailImage, deleteDetailImage } from '../lib/supabase'
import { resizeForUpload } from '../lib/resizeImage'
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Check, Pencil } from 'lucide-react'

interface ImageType {
  id: string
  company_id: string
  name: string
  images: string[]
  is_default: boolean
  sort_order: number
}

export default function CompanyImageTypes({ companyId, slug }: { companyId: string; slug: string }) {
  const [types, setTypes] = useState<ImageType[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // 업로드 중인 type id
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { load() }, [companyId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('company_image_types')
      .select('*')
      .eq('company_id', companyId)
      .order('sort_order')
      .order('created_at')
    setTypes((data as ImageType[]) ?? [])
    setLoading(false)
  }

  async function addType() {
    const name = window.prompt('상세 이미지 유형 이름 (예: 와인파티, 7:7 소개팅)')?.trim()
    if (!name) return
    await supabase.from('company_image_types').insert({
      company_id: companyId,
      name,
      is_default: types.length === 0, // 첫 유형은 자동 기본
      sort_order: types.length,
    })
    await load()
  }

  async function renameType(t: ImageType) {
    const name = window.prompt('유형 이름 변경', t.name)?.trim()
    if (!name || name === t.name) return
    await supabase.from('company_image_types').update({ name, updated_at: new Date().toISOString() }).eq('id', t.id)
    await load()
  }

  async function setDefault(t: ImageType) {
    if (t.is_default) return
    await supabase.from('company_image_types').update({ is_default: false }).eq('company_id', companyId)
    await supabase.from('company_image_types').update({ is_default: true }).eq('id', t.id)
    await load()
  }

  async function deleteType(t: ImageType) {
    if (!window.confirm(`'${t.name}' 유형을 삭제할까요? 이 유형을 쓰던 일정은 기본 유형으로 표시됩니다.`)) return
    // R2 파일 정리(실패해도 진행)
    for (const url of t.images) { try { await deleteDetailImage(url) } catch { /* noop */ } }
    await supabase.from('company_image_types').delete().eq('id', t.id)
    await load()
  }

  async function uploadImages(t: ImageType, files: FileList) {
    setBusy(t.id)
    try {
      const urls: string[] = []
      const failed: string[] = []
      for (let i = 0; i < files.length; i++) {
        try {
          // 원본 그대로 올리면 앱이 매번 수 MB짜리를 내려받는다 — 폭 1080 WebP로 굽는다
          const resized = await resizeForUpload(files[i])
          urls.push(await uploadDetailImage(resized, slug, t.id))
        } catch (e) {
          // 예전엔 파일마다 alert을 띄워서 10장 실패하면 10번 떴고, 어느 파일이
          // 실패했는지도 알 수 없었다. 모아서 한 번만 알린다.
          failed.push(`${files[i].name} — ${(e as Error).message}`)
        }
      }
      if (failed.length) alert(`업로드 실패 ${failed.length}건\n\n${failed.join('\n')}`)
      if (urls.length) {
        const next = [...t.images, ...urls]
        await supabase.from('company_image_types').update({ images: next, updated_at: new Date().toISOString() }).eq('id', t.id)
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  async function deleteImage(t: ImageType, url: string) {
    const next = t.images.filter((u) => u !== url)
    await supabase.from('company_image_types').update({ images: next, updated_at: new Date().toISOString() }).eq('id', t.id)
    try { await deleteDetailImage(url) } catch { /* noop */ }
    await load()
  }

  async function moveImage(t: ImageType, idx: number, dir: -1 | 1) {
    const next = [...t.images]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    await supabase.from('company_image_types').update({ images: next, updated_at: new Date().toISOString() }).eq('id', t.id)
    await load()
  }

  if (loading) return <p className="text-gray-400 text-sm px-2 py-3">불러오는 중...</p>

  return (
    <div className="space-y-4">
      {types.length === 0 && (
        <p className="text-sm text-gray-400">등록된 상세 이미지 유형이 없습니다. 유형을 추가하고 이미지를 올려주세요.</p>
      )}

      {types.map((t) => (
        <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-semibold text-gray-900 truncate">{t.name}</span>
              <button onClick={() => renameType(t)} title="이름 수정" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-gray-500 bg-gray-100 hover:bg-gray-200 shrink-0">
                <Pencil size={11} /> 이름
              </button>
              {t.is_default ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium shrink-0">
                  <Check size={12} /> 기본
                </span>
              ) : (
                <button onClick={() => setDefault(t)} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium hover:bg-gray-200 shrink-0">
                  기본으로
                </button>
              )}
            </div>
            <button onClick={() => deleteType(t)} className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 shrink-0">
              <Trash2 size={14} /> 유형 삭제
            </button>
          </div>

          {t.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {t.images.map((url, idx) => (
                <div key={url} className="relative w-28">
                  <img src={url} alt="" className="w-28 h-36 object-cover rounded-t border border-gray-200" />
                  {/* 컨트롤 항상 표시(모바일엔 hover 없음) */}
                  <div className="flex justify-between border border-t-0 border-gray-200 rounded-b bg-gray-50">
                    <button onClick={() => moveImage(t, idx, -1)} disabled={idx === 0} title="위로" className="p-1.5 text-gray-600 disabled:opacity-25 active:bg-gray-200"><ArrowUp size={15} /></button>
                    <button onClick={() => deleteImage(t, url)} title="삭제" className="p-1.5 text-red-500 active:bg-red-50"><Trash2 size={15} /></button>
                    <button onClick={() => moveImage(t, idx, 1)} disabled={idx === t.images.length - 1} title="아래로" className="p-1.5 text-gray-600 disabled:opacity-25 active:bg-gray-200"><ArrowDown size={15} /></button>
                  </div>
                  <span className="absolute top-1 left-1 bg-black/55 text-white text-[10px] px-1 rounded">{idx + 1}</span>
                </div>
              ))}
            </div>
          )}

          <input
            ref={(el) => { fileInputs.current[t.id] = el }}
            type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) uploadImages(t, e.target.files); e.target.value = '' }}
          />
          <button
            onClick={() => fileInputs.current[t.id]?.click()}
            disabled={busy === t.id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === t.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            이미지 추가 (여러 장 가능)
          </button>
        </div>
      ))}

      <button onClick={addType} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800">
        <Plus size={14} /> 이미지 유형 추가
      </button>
    </div>
  )
}
