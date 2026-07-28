import { useEffect, useRef, useState } from 'react'
import { supabase, uploadDetailImage, deleteDetailImage } from '../lib/supabase'
import { resizeForUpload } from '../lib/resizeImage'
import MatchKeywordEditor, { TitleLink, dedupeTitles } from './MatchKeywordEditor'
import { matchTypeByName } from '../lib/matchImageType'
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Pencil } from 'lucide-react'

interface ImageType {
  id: string
  company_id: string
  name: string
  images: string[]
  is_default: boolean
  sort_order: number
  match_keywords: string[] | null
}

export default function CompanyImageTypes({ companyId, slug }: { companyId: string; slug: string }) {
  const [types, setTypes] = useState<ImageType[]>([])
  // 이 업체 모임 제목 + 실제 페이지 링크.
  // 오너가 제목만 보고는 어떤 이미지를 붙일지 못 정한다 → 그 모임 페이지를 열어
  // 상세 이미지를 보면서 결정할 수 있게 링크까지 같이 들고 있는다.
  const [titles, setTitles] = useState<{ title: string; url: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // 업로드 중인 type id
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { load() }, [companyId])

  async function load() {
    setLoading(true)
    const [t, ev] = await Promise.all([
      supabase.from('company_image_types').select('*').eq('company_id', companyId)
        .order('sort_order').order('created_at'),
      supabase.from('events').select('title, source_url').eq('company_id', companyId).eq('is_active', true).limit(2000),
    ])
    setTypes((t.data as ImageType[]) ?? [])
    // 건수는 실제 모임 수 그대로. 목록에 보여줄 때만 제목 기준으로 중복을 접는다
    // (같은 제목이 지역·날짜만 달리해 수십 건씩 있다).
    setTitles(((ev.data as any[]) ?? [])
      .map((e) => ({ title: (e.title ?? '').trim(), url: e.source_url ?? '' }))
      .filter((e) => e.title))
    setLoading(false)
  }

  // 검색어 저장 — 실패를 조용히 넘기지 않는다(예전엔 error 를 안 봐서 안 눌린 것처럼 보였다)
  async function saveKeywords(t: ImageType, next: string[]) {
    setTypes((prev) => prev.map((x) => x.id === t.id ? { ...x, match_keywords: next } : x))
    const { error } = await supabase
      .from('company_image_types')
      .update({ match_keywords: next, updated_at: new Date().toISOString() })
      .eq('id', t.id)
    if (error) {
      setTypes((prev) => prev.map((x) => x.id === t.id ? { ...x, match_keywords: t.match_keywords } : x))
      alert(`검색어 저장 실패: ${error.message}`)
    }
  }

  async function addType() {
    const name = window.prompt('상세 이미지 유형 이름 (예: 와인파티, 7:7 소개팅)')?.trim()
    if (!name) return
    await supabase.from('company_image_types').insert({
      company_id: companyId,
      name,
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


  async function deleteType(t: ImageType) {
    if (!window.confirm(`'${t.name}' 유형을 삭제할까요? 이 유형이 붙던 모임은 상세 설명이 나오지 않게 됩니다.`)) return
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
            </div>
            <button onClick={() => deleteType(t)} className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 shrink-0">
              <Trash2 size={14} /> 유형 삭제
            </button>
          </div>

          <MatchKeywordEditor
            keywords={t.match_keywords ?? []}
            titles={titles}
            otherTypes={types.filter((x) => x.id !== t.id)}
            onChange={(next) => saveKeywords(t, next)}
          />

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

      {/* 어느 유형에도 안 걸리는 모임 — 이게 곧 "상세 설명이 안 나오는 모임"이다.
          빠진 검색어를 찾으라고 제목을 그대로 보여준다. */}
      {titles.length > 0 && (() => {
        const withImages = types.filter((x) => x.images.length > 0)
        const missed = titles.filter((r) => !matchTypeByName(r.title, withImages))
        const uniq = dedupeTitles(missed)
        if (!uniq.length) {
          return (
            <p className="mt-3 text-xs text-green-700">
              이 업체 모임 {titles.length}건 전부 어느 유형엔가 걸립니다.
            </p>
          )
        }
        return (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <p className="text-xs font-semibold text-orange-800 mb-1.5">
              상세 설명이 안 나오는 모임 {missed.length}건 ({uniq.length}종)
            </p>
            {/* 전체를 다 보여준다 — 오너가 하나씩 열어보며 어떤 이미지를 붙일지 정한다.
                프립처럼 종류가 많으면 길어지므로 이 목록만 따로 스크롤한다. */}
            <ul className="space-y-0.5 max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {uniq.map((r) => (
                <li key={r.title} className="min-w-0"><TitleLink row={r} /></li>
              ))}
            </ul>
          </div>
        )
      })()}
    </div>
  )
}
