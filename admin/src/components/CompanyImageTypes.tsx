import { useEffect, useRef, useState } from 'react'
import { supabase, uploadDetailImage, deleteDetailImage } from '../lib/supabase'
import { useAllHashtags } from '../hooks/useAllHashtags'
import { resizeForUpload } from '../lib/resizeImage'
import MatchKeywordEditor, { TitleLink, dedupeTitles } from './MatchKeywordEditor'
import HashtagEditor from './HashtagEditor'
import DetailImagePreview from './DetailImagePreview'
import { matchTypeByName } from '../lib/matchImageType'
import { suggestGroups, ungrouped, type TitleGroup } from '../lib/titleGroups'
import { Loader2, Plus, Trash2, ArrowUp, ArrowDown, Pencil, Maximize2 } from 'lucide-react'

interface ImageType {
  id: string
  company_id: string
  name: string
  images: string[]
  is_default: boolean
  sort_order: number
  match_keywords: string[] | null
  hashtags: string[] | null
}

export default function CompanyImageTypes({ companyId, slug }: { companyId: string; slug: string }) {
  const [types, setTypes] = useState<ImageType[]>([])
  // 이 업체 모임 제목 + 실제 페이지 링크.
  // 오너가 제목만 보고는 어떤 이미지를 붙일지 못 정한다 → 그 모임 페이지를 열어
  // 상세 이미지를 보면서 결정할 수 있게 링크까지 같이 들고 있는다.
  const [titles, setTitles] = useState<{ title: string; url: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null) // 업로드 중인 type id
  // 확대보기 — 썸네일이 잘려 보여서 제대로 올렸는지 확인이 안 됨
  const [preview, setPreview] = useState<{ name: string; images: string[]; index: number } | null>(null)
  // 해시태그는 입력 즉시 저장하지 않는다 — 칩 하나 넣을 때마다 '적용했습니다' 팝업이 떠
  // 입력을 끊고 오타를 유발했다(2026-07-29 오너 지적). 드래프트에 모아뒀다가
  // [저장] 버튼 한 번으로 유형 저장 + 매칭 일정 일괄 반영.
  const [tagDraft, setTagDraft] = useState<Record<string, string[]>>({})
  const [tagStatus, setTagStatus] = useState<Record<string, string>>({})
  // 자동완성 후보는 이 업체 범위가 아니라 서비스 전체 태그(용어 통일 목적).
  const allTags = useAllHashtags()
  // 어느 묶음을 펼쳐 제목까지 보고 있는지. null 이면 다 접힘.
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  // 묶어보기 / 전체 목록 — 기본은 묶어보기(오너: 건수 많은 유형부터 작업하려고 함)
  const [missedView, setMissedView] = useState<'group' | 'all'>('group')
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => { load() }, [companyId])

  async function load() {
    setLoading(true)
    const [t, ev] = await Promise.all([
      supabase.from('company_image_types').select('*').eq('company_id', companyId)
        .order('sort_order').order('created_at'),
      // 앞으로 열릴 일정만. 카드의 '일정' 숫자(company_admin_stats.upcoming_events)와
      // 기준이 같아야 한다 — 예전엔 여기만 지난 일정까지 세서, 같은 화면에 270과 653이
      // 같이 뜨는 상태였다(2026-07-28 오너 지적).
      supabase.from('events').select('title, source_url, hashtags')
        .eq('company_id', companyId).eq('is_active', true)
        .gte('event_date', new Date().toISOString())
        .limit(2000),
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


  // 유형 해시태그 저장 + 매칭 일정 일괄 반영. [저장] 버튼에서만 호출된다(오너 확정
  // 2026-07-29: 입력마다 저장·팝업이 떠 오타를 유발 → 드래프트에 모았다가 한 번에).
  // 결과는 팝업이 아니라 버튼 옆 인라인 문구로 알린다.
  async function commitTypeHashtags(t: ImageType) {
    const next = tagDraft[t.id] ?? t.hashtags ?? []
    setTagStatus((p) => ({ ...p, [t.id]: '저장 중...' }))
    const { error } = await supabase
      .from('company_image_types')
      .update({ hashtags: next, updated_at: new Date().toISOString() })
      .eq('id', t.id)
    if (error) {
      setTagStatus((p) => ({ ...p, [t.id]: `저장 실패: ${error.message}` }))
      return
    }
    setTypes((prev) => prev.map((x) => x.id === t.id ? { ...x, hashtags: next } : x))
    let applied = 0
    if (next.length > 0) {
      // 이 업체의 앞으로 일정 중, "가장 긴 키워드 매칭"이 이 유형으로 떨어지는 것만 갱신
      const { data: evs } = await supabase.from('events')
        .select('id, title')
        .eq('company_id', companyId)
        .gte('event_date', new Date().toISOString())
        .limit(2000)
      const allTypes = types.map((x) => x.id === t.id ? { ...x, hashtags: next } : x)
      const ids = (evs ?? [])
        .filter((e) => matchTypeByName(e.title ?? '', allTypes)?.id === t.id)
        .map((e) => e.id)
      // 한 건씩 await 하면 수백 건일 때 수십 초 + 이탈 시 부분 적용(277건 중 89건 사고).
      for (let i = 0; i < ids.length; i += 100) {
        const { error: e2 } = await supabase.from('events')
          .update({ hashtags: next }).in('id', ids.slice(i, i + 100))
        if (e2) { setTagStatus((p) => ({ ...p, [t.id]: `일정 반영 실패(${i}~): ${e2.message}` })); return }
      }
      applied = ids.length
    }
    setTagDraft((p) => { const n = { ...p }; delete n[t.id]; return n })
    setTagStatus((p) => ({ ...p, [t.id]: applied ? `저장 완료 · 일정 ${applied}건 적용` : '저장 완료' }))
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

  /** 묶음 구절을 검색어로 넣은 새 유형을 만든다 — 오너가 다시 타이핑하지 않게. */
  async function addTypeWithKeyword(phrase: string) {
    const name = window.prompt('새 유형 이름', phrase)?.trim()
    if (!name) return
    const { error } = await supabase.from('company_image_types').insert({
      company_id: companyId,
      name,
      match_keywords: [phrase],
      sort_order: types.length,
    })
    if (error) {
      alert(`유형 추가 실패: ${error.message}`)
      return
    }
    setOpenGroup(null)
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
      {preview && (
        <DetailImagePreview
          typeName={preview.name}
          images={preview.images}
          startIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}

      {types.length === 0 && (
        <p className="text-sm text-gray-400">등록된 상세 이미지 유형이 없습니다. 유형을 추가하고 이미지를 올려주세요.</p>
      )}

      {types.map((t) => (
        <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-3 min-w-0 max-w-full">
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

          {/* 유형 해시태그 — 이 유형에 매칭되는 모임은 자동 태그 대신 이 태그를 단다.
              비워 두면 크롤러 자동 태그 그대로(오너 확정). */}
          <div className="mb-3">
            <p className="text-xs text-gray-500 mb-1">
              해시태그 <span className="text-gray-400">(입력 후 [저장]을 눌러야 매칭된 모임에 반영됩니다 · 비우고 저장하면 자동 태그로 복귀)</span>
            </p>
            <HashtagEditor
              extraSuggestions={allTags}
              value={tagDraft[t.id] ?? t.hashtags ?? []}
              onChange={(next) => {
                setTagDraft((p) => ({ ...p, [t.id]: next }))
                setTagStatus((p) => ({ ...p, [t.id]: '' }))
              }}
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={() => commitTypeHashtags(t)}
                disabled={tagDraft[t.id] === undefined}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-pink-500 hover:bg-pink-600 disabled:bg-gray-200 disabled:text-gray-400"
              >
                저장
              </button>
              {tagDraft[t.id] !== undefined && <span className="text-xs text-amber-600">저장 안 됨</span>}
              {tagStatus[t.id] && <span className="text-xs text-gray-500">{tagStatus[t.id]}</span>}
            </div>
          </div>

          {t.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {t.images.map((url, idx) => (
                <div key={url} className="relative w-28">
                  {/* 썸네일은 잘려 보이므로(세로로 아주 긴 캡처) 눌러서 원본 비율로 확인 */}
                  <button
                    type="button"
                    onClick={() => setPreview({ name: t.name, images: t.images, index: idx })}
                    className="block w-28 rounded-t border border-gray-200 overflow-hidden"
                    title="크게 보기"
                  >
                    <img src={url} alt="" className="w-28 h-36 object-cover" />
                  </button>
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
          {t.images.length > 0 && (
            <button
              onClick={() => setPreview({ name: t.name, images: t.images, index: 0 })}
              className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Maximize2 size={14} />
              앱에서 보이는 대로 보기
            </button>
          )}
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
        // 제목이 자유롭게 쓰인 업체(문토·프립)는 목록만 봐선 공통점이 안 보인다.
        // 자주 나오는 구절로 묶어 '몇 건이 걸리는지'를 보여줘, 큰 덩어리부터
        // 작업할 수 있게 한다(2026-07-30 오너 요청).
        // ⚠️ 묶음은 종(uniq)이 아니라 실제 모임 전체(missed)로 센다. 오너가 보려는 건
        //    "이 유형을 만들면 모임 몇 건이 해결되나"이기 때문. 종 기준으로 세면
        //    프립이 5건·4건처럼 나와 큰 덩어리가 안 보였다.
        const groups = suggestGroups(missed)
        const rest = ungrouped(missed, groups)
        return (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-semibold text-orange-800">
                상세 설명이 안 나오는 모임 {missed.length}건 ({uniq.length}종)
              </p>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setMissedView('group')}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${missedView === 'group' ? 'bg-orange-600 text-white' : 'bg-white text-orange-700 border border-orange-200'}`}
                >
                  묶어보기
                </button>
                <button
                  onClick={() => setMissedView('all')}
                  className={`px-2 py-0.5 rounded text-xs font-medium ${missedView === 'all' ? 'bg-orange-600 text-white' : 'bg-white text-orange-700 border border-orange-200'}`}
                >
                  전체 목록
                </button>
              </div>
            </div>

            {missedView === 'group' ? (
              <div className="max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-1">
                {groups.length === 0 && (
                  <p className="text-xs text-orange-700">묶일 만한 공통 구절이 없습니다. 전체 목록에서 확인하세요.</p>
                )}
                {groups.map((g: TitleGroup) => {
                  const open = openGroup === g.phrase
                  return (
                    <div key={g.phrase} className="rounded border border-orange-200 bg-white">
                      <button
                        onClick={() => setOpenGroup(open ? null : g.phrase)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
                      >
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-xs font-bold tabular-nums">
                          {g.rows.length}건
                        </span>
                        <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-800">{g.phrase}</span>
                        <span className="shrink-0 text-xs text-gray-400">{open ? '접기' : '제목 보기'}</span>
                      </button>
                      {open && (
                        <div className="border-t border-orange-100 px-2 py-1.5 space-y-1">
                          <button
                            onClick={() => addTypeWithKeyword(g.phrase)}
                            className="px-2 py-1 rounded bg-orange-600 text-white text-xs font-bold hover:bg-orange-700"
                          >
                            이 구절로 유형 만들기
                          </button>
                          {/* 같은 제목이 지역·날짜만 달리해 수십 건씩 있으므로 제목은 접어서 보여준다. */}
                          <ul className="space-y-0.5">
                            {dedupeTitles(g.rows).map((r) => (
                              <li key={r.title} className="min-w-0"><TitleLink row={r} /></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })}
                {rest.length > 0 && (
                  <p className="pt-1 text-xs text-orange-700">
                    묶이지 않은 모임 {rest.length}건({dedupeTitles(rest).length}종) — 전체 목록에서 확인하세요.
                  </p>
                )}
              </div>
            ) : (
              /* 전체를 다 보여준다 — 오너가 하나씩 열어보며 어떤 이미지를 붙일지 정한다.
                 프립처럼 종류가 많으면 길어지므로 이 목록만 따로 스크롤한다. */
              <ul className="space-y-0.5 max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {uniq.map((r) => (
                  <li key={r.title} className="min-w-0"><TitleLink row={r} /></li>
                ))}
              </ul>
            )}
          </div>
        )
      })()}
    </div>
  )
}
