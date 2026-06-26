import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Trash2, ExternalLink, Loader2, Check } from 'lucide-react'
import DateTimePicker from '../components/DateTimePicker'

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
  is_closed: boolean
  source: 'crawl' | 'manual'
  saved: boolean
  saving: boolean
}

export default function Register() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filterCompany, setFilterCompany] = useState('')
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
      .select('id, company_id, event_date, source_url, location_region, capacity_male, seats_left_male, price_male, capacity_female, seats_left_female, price_female, age_male, age_female, is_closed, source, companies(name)')
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
        event_date: toLocalInput(e.event_date),
        source_url: e.source_url,
        location_region: e.location_region ?? '',
        capacity_male: s(e.capacity_male), seats_left_male: s(e.seats_left_male), price_male: s(e.price_male),
        capacity_female: s(e.capacity_female), seats_left_female: s(e.seats_left_female), price_female: s(e.price_female),
        age_male: e.age_male ?? '', age_female: e.age_female ?? '',
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
      age_male: row.age_male.trim() || null,
      age_female: row.age_female.trim() || null,
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

      <div className="flex items-center gap-3 mb-4 text-sm">
        <span className="text-gray-400">{visibleRows.length}건</span>
        {msg && <span className="text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5">{msg}</span>}
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400 p-6">예정 날짜 불러오는 중...</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-400 p-6">
            표시할 예정 날짜가 없습니다. 크롤러 발견(<code>discover_candidates.py</code>) 후 새로고침하거나 [직접 추가]로 입력하세요.
          </p>
        </div>
      ) : (
        <>
        {/* 모바일: 카드형 (한 이벤트 = 세로 카드) */}
        <div className="md:hidden space-y-3">
          {visibleRows.map((r) => (
            <div key={r.key} className={`rounded-xl border p-4 shadow-sm ${r.source === 'manual' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
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

              {/* 일시 + 지역 — 아래 남/여 박스와 가로폭·라인 동일 (grid-cols-2 gap-2.5) */}
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
                    <CardInput label="정원" type="number" value={r.capacity_male} onChange={(v) => patch(r.key, 'capacity_male', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="잔여" type="number" value={r.seats_left_male} onChange={(v) => patch(r.key, 'seats_left_male', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="가격" type="number" value={r.price_male} onChange={(v) => patch(r.key, 'price_male', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="연령" value={r.age_male} placeholder="예 27~34" onChange={(v) => patch(r.key, 'age_male', v)} onBlur={() => flushSave(r.key)} />
                  </div>
                </div>
                <div className="rounded-lg bg-pink-50/60 p-2.5">
                  <p className="text-xs font-semibold text-pink-600 mb-2">여성</p>
                  <div className="grid grid-cols-2 gap-2">
                    <CardInput label="정원" type="number" value={r.capacity_female} onChange={(v) => patch(r.key, 'capacity_female', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="잔여" type="number" value={r.seats_left_female} onChange={(v) => patch(r.key, 'seats_left_female', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="가격" type="number" value={r.price_female} onChange={(v) => patch(r.key, 'price_female', v)} onBlur={() => flushSave(r.key)} />
                    <CardInput label="연령" value={r.age_female} placeholder="예 25~32" onChange={(v) => patch(r.key, 'age_female', v)} onBlur={() => flushSave(r.key)} />
                  </div>
                </div>
              </div>
            </div>
          ))}
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
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 정원</th>
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 잔여</th>
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 가격</th>
                <th className="px-3 py-2.5 text-center font-medium text-blue-600">남 연령</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 정원</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 잔여</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 가격</th>
                <th className="px-3 py-2.5 text-center font-medium text-pink-600">여 연령</th>
                <th className="px-3 py-2.5 text-center font-medium">마감</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((r) => (
                <tr key={r.key} className={r.source === 'manual' ? 'bg-amber-50/30' : ''}>
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
                    {/* 업체명은 항상 고정값 (전체 탭 포함) */}
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
                  <NumCell value={r.capacity_male} onChange={(v) => patch(r.key, 'capacity_male', v)} onBlur={() => flushSave(r.key)} />
                  <NumCell value={r.seats_left_male} onChange={(v) => patch(r.key, 'seats_left_male', v)} onBlur={() => flushSave(r.key)} />
                  <NumCell value={r.price_male} onChange={(v) => patch(r.key, 'price_male', v)} onBlur={() => flushSave(r.key)} wide />
                  <AgeCell value={r.age_male} onChange={(v) => patch(r.key, 'age_male', v)} onBlur={() => flushSave(r.key)} />
                  <NumCell value={r.capacity_female} onChange={(v) => patch(r.key, 'capacity_female', v)} onBlur={() => flushSave(r.key)} />
                  <NumCell value={r.seats_left_female} onChange={(v) => patch(r.key, 'seats_left_female', v)} onBlur={() => flushSave(r.key)} />
                  <NumCell value={r.price_female} onChange={(v) => patch(r.key, 'price_female', v)} onBlur={() => flushSave(r.key)} wide />
                  <AgeCell value={r.age_female} onChange={(v) => patch(r.key, 'age_female', v)} onBlur={() => flushSave(r.key)} />
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
              ))}
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
function CardInput({ label, value, onChange, onBlur, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onBlur: () => void
  type?: string; placeholder?: string
}) {
  return (
    <div>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full text-center bg-white placeholder:text-gray-300" />
    </div>
  )
}

// 참가 연령대 — 사이트에서 본 그대로 자유 입력 (예: "27~34", "20대~30대 초반")
function AgeCell({ value, onChange, onBlur }: {
  value: string; onChange: (v: string) => void; onBlur: () => void
}) {
  return (
    <td className="px-2 py-2 text-center">
      <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        placeholder="예 27~34"
        className="border border-gray-200 rounded px-2 py-1 text-sm text-center w-20 placeholder:text-gray-300" />
    </td>
  )
}

function makeRow(p: Partial<Row>): Row {
  return {
    key: crypto.randomUUID(),
    candidate_id: null,
    company_id: '',
    company_name: '',
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
    is_closed: false,
    source: 'manual',
    saved: false,
    saving: false,
    ...p,
  }
}

function numOrNull(v: string): number | null {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
