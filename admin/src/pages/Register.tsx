import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Trash2, ExternalLink, Loader2, Check } from 'lucide-react'
import DateTimePicker from '../components/DateTimePicker'
import HashtagEditor from '../components/HashtagEditor'

/**
 * 직접 등록 페이지 — 크롤링 정확도 무시. 오너 입력값이 정답(source of truth).
 *
 * 자동(시스템): 업체별 예정 날짜 + 확인링크 + 지역을 event_candidates 에서 읽어 리스트업.
 * 입력(오너=정답): 정원·잔여·가격은 전부 빈칸 기본값. [확인하기]로 실제 페이지 확인 후 입력.
 * 즉시 반영: 칸을 수정하고 벗어나면(blur) 바로 events 에 저장 → 앱에 즉시 반영.
 * + 크롤링과 별개로 [직접 추가]로 수동 등록도 가능.
 */

type Company = { id: string; name: string }

type Row = {
  key: string
  candidate_id: string | null
  company_id: string
  company_name: string
  company_slug: string
  event_date: string // datetime-local
  source_url: string // 확인 링크
  location_region: string
  price_male: string
  price_female: string
  capacity_male: string
  capacity_female: string
  seats_left_male: string
  seats_left_female: string
  age_male: string // 남 참가 연령대 (자유 텍스트, 예: 27~34)
  age_female: string // 여 참가 연령대
  hashtags: string[]
  is_closed: boolean
  source: 'crawl' | 'manual'
  price_detail: PriceDetail | null // 가격 티어(에모셔널오렌지 자동). 읽기전용 표시.
  saved: boolean
  saving: boolean
}

type GenderPrice = {
  regular?: number
  regular_soldout?: boolean
  earlybird?: number
  earlybird_soldout?: boolean
}
type PriceDetail = { male?: GenderPrice; female?: GenderPrice }

export default function Register() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filterCompany, setFilterCompany] = useState('')
  const [statusTab, setStatusTab] = useState<'todo' | 'done'>('todo') // 해야할 것 / 입력 완료
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  // 자동저장 시 최신 row 참조용 + 디바운스 타이머 + 저장중/추가편집 추적
  const rowsRef = useRef<Row[]>([])
  useEffect(() => { rowsRef.current = rows }, [rows])
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savingKeys = useRef<Set<string>>(new Set())
  const dirtyKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    supabase
      .from('companies')
      .select('id, name')
      .order('name')
      .then(({ data }) => setCompanies(data ?? []))
    loadCandidates()
  }, [])

  // events 를 그대로 자동 리스트업 (정원·잔여·가격은 채워졌으면 표시, 비었으면 빈칸)
  // 표시 범위: 오늘 ~ 오늘+2개월
  async function loadCandidates() {
    setLoading(true)
    const now = new Date()
    const horizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
    const { data, error } = await supabase
      .from('events')
      .select('id, company_id, event_date, source_url, location_region, capacity_male, seats_left_male, price_male, capacity_female, seats_left_female, price_female, price_detail, age_male, age_female, hashtags, is_closed, source, companies(name, slug)')
      .eq('is_active', true)
      .gte('event_date', now.toISOString())
      .lte('event_date', horizon.toISOString())
      .order('company_id')
      .order('event_date')
    if (error) {
      setMsg(`로딩 오류: ${error.message}`)
      setLoading(false)
      return
    }
    const s = (v: number | null) => (v == null ? '' : String(v))
    const evRows: Row[] = (data ?? []).map((e: any) =>
      makeRow({
        company_id: e.company_id,
        company_name: e.companies?.name ?? '',
        company_slug: e.companies?.slug ?? '',
        event_date: toLocalInput(e.event_date),
        source_url: e.source_url,
        location_region: e.location_region ?? '',
        capacity_male: s(e.capacity_male), seats_left_male: s(e.seats_left_male), price_male: s(e.price_male),
        capacity_female: s(e.capacity_female), seats_left_female: s(e.seats_left_female), price_female: s(e.price_female),
        age_male: e.age_male ?? '', age_female: e.age_female ?? '',
        price_detail: e.price_detail ?? null,
        hashtags: e.hashtags ?? [],
        is_closed: e.is_closed ?? false,
        source: e.source === 'crawl' ? 'crawl' : 'manual', // crawl=미입력(흰), 그외=오너입력(노랑)
      }),
    )
    // 아직 저장 안 한 수동 추가 행(빈 source_url)은 보존
    setRows((prev) => [...prev.filter((r) => !r.source_url), ...evRows])
    setLoading(false)
  }

  const visibleRows = useMemo(
    () => (filterCompany ? rows.filter((r) => r.company_id === filterCompany) : rows),
    [rows, filterCompany],
  )

  // 업체별 건수 (탭 배지용)
  const companyCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) m[r.company_id] = (m[r.company_id] ?? 0) + 1
    return m
  }, [rows])

  function patch(key: string, field: keyof Row, value: string | boolean) {
    setRows((rs) => {
      const next = rs.map((r) => (r.key === key ? { ...r, [field]: value, saved: false } : r))
      rowsRef.current = next // 즉시 동기화 (저장이 최신값 읽도록)
      return next
    })
    scheduleSave(key)
  }

  // 해시태그(string[])는 patch(문자열/불리언 전용)로 못 받으므로 별도 갱신 + 기존 저장 흐름 재사용
  function patchHashtags(key: string, next: string[]) {
    setRows((rs) => {
      const updated = rs.map((r) => (r.key === key ? { ...r, hashtags: next, saved: false } : r))
      rowsRef.current = updated
      return updated
    })
    scheduleSave(key)
  }

  // 디바운스: 입력 멈추고 500ms 후 한 번에 저장 (칸별 경쟁 방지)
  function scheduleSave(key: string) {
    clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = setTimeout(() => flushSave(key), 500)
  }

  // blur 시 즉시 저장 예약(디바운스 짧게) — 칸 벗어나면 곧바로 반영
  function flushSave(key: string) {
    clearTimeout(saveTimers.current[key])
    autoSave(key)
  }

  // 한 행을 events 에 저장. 저장 중 추가 편집이 오면 끝나고 다시 저장(최신값 보장)
  async function autoSave(key: string) {
    if (savingKeys.current.has(key)) { dirtyKeys.current.add(key); return }
    const row = rowsRef.current.find((r) => r.key === key)
    if (!row) return
    if (!row.company_id || !row.event_date || !row.source_url) return // 필수값 부족 → 보류

    savingKeys.current.add(key)
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, saving: true } : r)))
    const ageNums = [...extractAges(row.age_male), ...extractAges(row.age_female)]
    const payload = {
      company_id: row.company_id,
      title: row.company_name || '모임',
      event_date: new Date(row.event_date).toISOString(),
      location_region: row.location_region || '미정',
      source_url: row.source_url,
      price_male: numOrNull(row.price_male),
      price_female: numOrNull(row.price_female),
      capacity_male: numOrNull(row.capacity_male),
      capacity_female: numOrNull(row.capacity_female),
      seats_left_male: numOrNull(row.seats_left_male),
      seats_left_female: numOrNull(row.seats_left_female),
      // 텍스트는 "27~34"로 정규화 저장(앱 표시 깔끔), 구간은 4자리 분리 포함해 산출
      age_male: normalizeAge(row.age_male),
      age_female: normalizeAge(row.age_female),
      age_range_min: ageNums.length ? Math.min(...ageNums) : null,
      age_range_max: ageNums.length ? Math.max(...ageNums) : null,
      hashtags: row.hashtags,
      is_closed: row.is_closed,
      is_active: true,
      source: 'verified', // 오너가 손댄 이벤트 → 발견 재실행 시 덮어쓰지 않음(crawl만 교체)
    }
    const { error } = await supabase.from('events').upsert(payload, { onConflict: 'source_url' })
    savingKeys.current.delete(key)
    if (error) {
      setMsg(`저장 실패: ${error.message}`)
      setRows((rs) => rs.map((r) => (r.key === key ? { ...r, saving: false } : r)))
      return
    }
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, saving: false, saved: true } : r)))
    // 저장 중 들어온 추가 편집이 있으면 최신값으로 한 번 더 저장
    if (dirtyKeys.current.has(key)) {
      dirtyKeys.current.delete(key)
      autoSave(key)
    }
  }

  // ── 완료/해야할것 판정: 가격(남 또는 여)이 입력됐으면 "완료" ──
  // 나이는 완료 조건이 아님 — 나이 제한 없는 모임(프립 등)이 많고, 없는 걸 확인해도
  // 달라질 게 없어 오너가 "가격만 있으면 완료로 보라" 지시(2026-07). 가격 없으면 미완료.
  const isRowDone = (r: Row) =>
    r.price_male.trim() !== '' || r.price_female.trim() !== ''
  const todoRows = useMemo(() => visibleRows.filter((r) => !isRowDone(r)), [visibleRows])
  const doneRows = useMemo(() => visibleRows.filter((r) => isRowDone(r)), [visibleRows])
  const shownRows = statusTab === 'todo' ? todoRows : doneRows

  // ── 모바일 카드 한 장 렌더 ──
  const renderCard = (r: Row) => (
    <div key={r.key} className={`rounded-xl border p-4 shadow-sm ${isRowDone(r) ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50/50'}`}>
      {/* 헤더: 업체명 옆에 확인하기 / 오른쪽에 마감·삭제 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-bold text-gray-900 truncate min-w-0">{r.company_name}</span>
        {r.saving ? <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" /> : r.saved ? <Check size={15} className="text-green-500 shrink-0" /> : null}
        {r.source_url && (
          <a href={r.source_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-pink-600 text-sm font-medium shrink-0">
            <ExternalLink size={14} /> 확인하기
          </a>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
          <input type="checkbox" checked={r.is_closed}
            onChange={(e) => { patch(r.key, 'is_closed', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
          마감
        </label>
        <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 shrink-0">
          <Trash2 size={13} /> 삭제
        </button>
      </div>

      {/* 링크 없을 때(수동 추가)만 URL 입력 */}
      {!r.source_url && (
        <div className="mb-3">
          <p className="text-xs text-gray-400 mb-1">확인 링크 URL</p>
          <input value={r.source_url} onChange={(e) => patch(r.key, 'source_url', e.target.value)}
            onBlur={() => flushSave(r.key)} placeholder="링크 URL"
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full" />
        </div>
      )}

      {/* 일시 + 지역 */}
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        <div className="min-w-0">
          <p className="text-xs text-gray-400 mb-1">일시</p>
          <DateTimePicker fullWidth value={r.event_date} onChange={(v) => patch(r.key, 'event_date', v)} onCommit={() => flushSave(r.key)} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-400 mb-1">지역</p>
          <input value={r.location_region} onChange={(e) => patch(r.key, 'location_region', e.target.value)}
            onBlur={() => flushSave(r.key)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full bg-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg bg-blue-50/60 p-2.5">
          <p className="text-xs font-semibold text-blue-600 mb-2">남성</p>
          <div className="grid grid-cols-2 gap-2">
            <CardInput label="가격" type="number" value={r.price_male} onChange={(v) => patch(r.key, 'price_male', v)} onBlur={() => flushSave(r.key)} />
            <CardInput label="연령" value={r.age_male} placeholder="예 2734" hint={bornHint(r.company_slug, r.age_male)} onChange={(v) => patch(r.key, 'age_male', v)} onBlur={() => flushSave(r.key)} />
          </div>
        </div>
        <div className="rounded-lg bg-pink-50/60 p-2.5">
          <p className="text-xs font-semibold text-pink-600 mb-2">여성</p>
          <div className="grid grid-cols-2 gap-2">
            <CardInput label="가격" type="number" value={r.price_female} onChange={(v) => patch(r.key, 'price_female', v)} onBlur={() => flushSave(r.key)} />
            <CardInput label="연령" value={r.age_female} placeholder="예 2532" hint={bornHint(r.company_slug, r.age_female)} onChange={(v) => patch(r.key, 'age_female', v)} onBlur={() => flushSave(r.key)} />
          </div>
        </div>
      </div>

      {/* 자동 크롤 가격/품절 참고표시 (읽기용, 입력란은 위에서 편집 가능) */}
      {r.price_detail && <PriceDetailReadout detail={r.price_detail} />}

      {/* 해시태그 */}
      <div className="mt-2.5">
        <p className="text-xs text-gray-400 mb-1">해시태그</p>
        <HashtagEditor value={r.hashtags} onChange={(next) => patchHashtags(r.key, next)} />
      </div>
    </div>
  )

  // ── 데스크탑 표 행 렌더(2행: 입력행 + 추천 해시태그행) ──
  const renderTableRow = (r: Row) => (
    <Fragment key={r.key}>
    <tr className={isRowDone(r) ? '' : 'bg-amber-50/60'}>
      <td className="px-3 py-2">
        {r.source_url ? (
          <a href={r.source_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-pink-600 hover:underline">
            <ExternalLink size={14} /> 확인하기
          </a>
        ) : (
          <input value={r.source_url} onChange={(e) => patch(r.key, 'source_url', e.target.value)}
            onBlur={() => flushSave(r.key)} placeholder="링크 URL"
            className="border border-gray-200 rounded px-2 py-1 text-sm w-36" />
        )}
      </td>
      <td className="px-2 py-2 text-center">
        {r.saving ? (
          <Loader2 size={14} className="animate-spin text-gray-400" />
        ) : r.saved ? (
          <Check size={15} className="text-green-500" />
        ) : null}
      </td>
      <td className="px-3 py-2">
        <span className="font-medium text-gray-800">{r.company_name}</span>
      </td>
      <td className="px-3 py-2">
        <DateTimePicker
          value={r.event_date}
          onChange={(v) => patch(r.key, 'event_date', v)}
          onCommit={() => flushSave(r.key)}
        />
      </td>
      <td className="px-3 py-2">
        <input value={r.location_region} onChange={(e) => patch(r.key, 'location_region', e.target.value)}
          onBlur={() => flushSave(r.key)}
          className="border border-gray-200 rounded px-2 py-1 text-sm w-20" />
      </td>
      <NumCell value={r.price_male} onChange={(v) => patch(r.key, 'price_male', v)} onBlur={() => flushSave(r.key)} wide />
      <AgeCell value={r.age_male} hint={bornHint(r.company_slug, r.age_male)} onChange={(v) => patch(r.key, 'age_male', v)} onBlur={() => flushSave(r.key)} />
      <NumCell value={r.price_female} onChange={(v) => patch(r.key, 'price_female', v)} onBlur={() => flushSave(r.key)} wide />
      <AgeCell value={r.age_female} hint={bornHint(r.company_slug, r.age_female)} onChange={(v) => patch(r.key, 'age_female', v)} onBlur={() => flushSave(r.key)} />
      <td className="px-3 py-2 align-middle">
        <div className="w-64">
          <HashtagEditor value={r.hashtags} onChange={(next) => patchHashtags(r.key, next)} showSuggestions={false} compact />
        </div>
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={r.is_closed}
          onChange={(e) => { patch(r.key, 'is_closed', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
      </td>
      <td className="px-3 py-2 text-right">
        <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
          <Trash2 size={14} /> 삭제
        </button>
      </td>
    </tr>
    <tr className={`border-b border-gray-100 ${isRowDone(r) ? '' : 'bg-amber-50/60'}`}>
      <td colSpan={12} className="px-3 pt-0 pb-3 whitespace-normal">
        <div className="flex items-start gap-2">
          <span className="text-xs text-gray-400 shrink-0 pt-0.5">추천</span>
          <div className="min-w-0 flex-1">
            <HashtagEditor value={r.hashtags} onChange={(next) => patchHashtags(r.key, next)} showInput={false} />
          </div>
        </div>
      </td>
    </tr>
    </Fragment>
  )

  return (
    <div className="p-4 md:p-8 max-w-[1500px]">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">이벤트 직접 등록</h1>
        <p className="text-sm text-gray-500 mt-1">
          업체별 예정 날짜는 자동으로 리스트업됩니다. <b>[확인하기]</b> 링크로 직접 확인 후 정원·잔여·가격을 입력하세요.
          입력칸은 모두 빈칸이며, <b>수정하고 칸을 벗어나면 즉시 저장</b>됩니다.
        </p>
      </div>

      {/* 업체별 탭 — 담당자별로 자기 업체 탭만 보고 입력하도록 구분 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilterCompany('')}
          className={tabClass(filterCompany === '')}
        >
          전체 <span className="opacity-60">{rows.length}</span>
        </button>
        {companies
          .filter((c) => (companyCounts[c.id] ?? 0) > 0)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCompany(c.id)}
              className={tabClass(filterCompany === c.id)}
            >
              {c.name} <span className="opacity-60">{companyCounts[c.id] ?? 0}</span>
            </button>
          ))}
      </div>

      {/* 상태 탭 — 해야할 것 / 입력 완료 각각 분리해서 봄 */}
      <div className="flex items-center gap-2 mb-4 border-b border-gray-200">
        <button
          onClick={() => setStatusTab('todo')}
          className={`px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${statusTab === 'todo' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          🔴 해야할 것 <span className="ml-0.5">{todoRows.length}</span>
        </button>
        <button
          onClick={() => setStatusTab('done')}
          className={`px-4 py-2.5 text-sm font-bold -mb-px border-b-2 ${statusTab === 'done' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
        >
          ✅ 입력 완료 <span className="ml-0.5">{doneRows.length}</span>
        </button>
        {msg && <span className="ml-auto text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 text-sm">{msg}</span>}
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400 p-6">예정 날짜 불러오는 중...</p>
        </div>
      ) : shownRows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400 p-6">
            {statusTab === 'todo'
              ? '해야할 것이 없습니다. 모두 입력 완료했거나, 크롤러 발견 후 새로고침하세요.'
              : '입력 완료된 이벤트가 아직 없습니다. 해야할 것 탭에서 가격·연령을 입력하세요.'}
          </p>
        </div>
      ) : (
        <>
        {/* 모바일: 카드형 — 선택된 탭 목록만 표시 */}
        <div className="md:hidden space-y-3">
          {shownRows.map(renderCard)}
        </div>

        {/* 데스크탑: 표 */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">확인</th>
                <th className="px-3 py-2.5 text-left font-medium w-6"></th>
                <th className="px-3 py-2.5 text-left font-medium">업체</th>
                <th className="px-3 py-2.5 text-left font-medium">날짜/시간</th>
                <th className="px-3 py-2.5 text-left font-medium">지역</th>
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 가격</th>
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 연령</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 가격</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 연령</th>
                <th className="px-3 py-2.5 text-left font-medium">해시태그</th>
                <th className="px-3 py-2.5 text-center font-medium">마감</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map(renderTableRow)}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  )
}

// 업체 탭 칩 스타일 (선택=핑크, 비선택=회색)
function tabClass(active: boolean): string {
  return active
    ? 'px-3.5 py-2 rounded-lg text-sm font-semibold bg-pink-500 text-white'
    : 'px-3.5 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
}

function NumCell({ value, onChange, onBlur, wide }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; wide?: boolean
}) {
  return (
    <td className="px-2 py-2 text-center">
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        className={`border border-gray-200 rounded px-2 py-1 text-sm text-center ${wide ? 'w-24' : 'w-14'}`} />
    </td>
  )
}

// 모바일 카드용 라벨 달린 입력칸
// 가격 티어 읽기 표시(에모셔널오렌지 자동). 얼리버드 품절이면 취소선.
function CardInput({ label, value, onChange, onBlur, type = 'text', placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; onBlur: () => void
  type?: string; placeholder?: string; hint?: string | null
}) {
  return (
    <div>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full text-center bg-white placeholder:text-gray-300" />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5 text-center">{hint}</p>}
    </div>
  )
}

// 참가 연령대 — 사이트에서 본 그대로 자유 입력 (예: "27~34", "20대~30대 초반")
function AgeCell({ value, onChange, onBlur, hint }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; hint?: string | null
}) {
  return (
    <td className="px-2 py-2 text-center">
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        placeholder="예 2734"
        className="border border-gray-200 rounded px-2 py-1 text-sm text-center w-20 placeholder:text-gray-300" />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </td>
  )
}

// 만나이→출생연도(YY년생) 힌트 (오너 검증용, 작게 표시). frip 포함:
// frip은 참가연령이 대부분 '88~04년생' 등 년생 기반이라 년도 힌트가 맞음(제외 금지).
// 나이가 'NN~NN' 숫자범위일 때만 힌트가 뜸('2030' 밴드 등은 안 뜸 → 정상).
const BIRTH_YEAR_VENDORS = new Set(['yeonin', 'lovecommunity-loco', 'talkblossom', 'frip'])
function bornHint(slug: string, age: string): string | null {
  if (!BIRTH_YEAR_VENDORS.has(slug)) return null
  const m = age.match(/^(\d{1,2})\s*[~\-]\s*(\d{1,2})$/)
  if (!m) return null
  const yr = new Date().getFullYear()
  const p = (n: number) => String(((n % 100) + 100) % 100).padStart(2, '0')
  return `${p(yr - parseInt(m[2]))}-${p(yr - parseInt(m[1]))}년생`  // 나이많은쪽(이른출생)-나이적은쪽
}

// 자동 크롤 가격/품절 참고표시 (읽기용 — 입력란은 별도로 편집 가능)
function PriceDetailReadout({ detail }: { detail: PriceDetail }) {
  const won = (n: number) => `${n.toLocaleString()}원`
  const line = (label: string, g?: GenderPrice) => {
    if (!g || (g.regular == null && g.earlybird == null)) return null
    return (
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-gray-400 w-8">{label}</span>
        {g.regular != null && (
          <span className={g.regular_soldout ? 'line-through text-gray-400' : 'text-gray-700'}>
            {won(g.regular)}{g.regular_soldout ? ' (품절)' : ''}
          </span>
        )}
        {g.earlybird != null && (
          <span className={g.earlybird_soldout ? 'line-through text-gray-400' : 'text-gray-500'}>
            · 얼리버드 {won(g.earlybird)}{g.earlybird_soldout ? ' (품절)' : ''}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
      <p className="text-[10px] text-gray-400 mb-1">자동 크롤 가격·품절(참고)</p>
      {line('남', detail.male)}
      {line('여', detail.female)}
    </div>
  )
}

function makeRow(p: Partial<Row>): Row {
  return {
    key: crypto.randomUUID(),
    candidate_id: null,
    company_id: '',
    company_name: '',
    company_slug: '',
    event_date: '',
    source_url: '',
    location_region: '',
    price_male: '',
    price_female: '',
    capacity_male: '',
    capacity_female: '',
    seats_left_male: '',
    seats_left_female: '',
    age_male: '',
    age_female: '',
    hashtags: [],
    is_closed: false,
    source: 'manual',
    price_detail: null,
    saved: false,
    saving: false,
    ...p,
  }
}

function numOrNull(v: string): number | null {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

// 연령 텍스트에서 나이 숫자들 추출. 구분자 없는 4자리(예: 2734)는 앞2/뒤2로 쪼갬(20~40대 기본).
// DB 제약(18~60) 밖은 버림.
function extractAges(text: string): number[] {
  const out: number[] = []
  for (const g of (text || '').match(/\d+/g) || []) {
    if (g.length === 4) out.push(parseInt(g.slice(0, 2), 10), parseInt(g.slice(2), 10))
    else out.push(parseInt(g, 10))
  }
  return out.filter((n) => Number.isFinite(n) && n >= 18 && n <= 60)
}

// 저장용 정규화: "2734"/"27 34" → "27~34". 글자 섞인 자유표현은 그대로 둠.
function normalizeAge(text: string): string | null {
  const t = (text || '').trim()
  if (!t) return null
  if (!/^[\d\s~,.\-]+$/.test(t)) return t
  const ages = extractAges(t)
  if (ages.length >= 2) return `${Math.min(...ages)}~${Math.max(...ages)}`
  if (ages.length === 1) return String(ages[0])
  return t
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
