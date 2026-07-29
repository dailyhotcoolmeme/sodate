import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Trash2, ExternalLink, Loader2, Check, Search, X, ChevronDown, ChevronUp } from 'lucide-react'
import DateTimePicker from '../components/DateTimePicker'
import HashtagEditor from '../components/HashtagEditor'

/**
 * 일정 관리 페이지(메뉴명 '일정 관리', 경로 /register) — 크롤링된 일정을 검수·수정한다.
 * 오너 입력값이 정답(source of truth).
 *
 * 자동(시스템): 업체별 예정 날짜 + 확인링크 + 지역을 event_candidates 에서 읽어 리스트업.
 * 입력(오너=정답): 정원·잔여·가격은 전부 빈칸 기본값. [확인하기]로 실제 페이지 확인 후 입력.
 * 즉시 반영: 칸을 수정하고 벗어나면(blur) 바로 events 에 저장 → 앱에 즉시 반영.
 * + 크롤링과 별개로 [직접 추가]로 수동 등록도 가능.
 */

type Company = { id: string; name: string }

type Row = {
  key: string
  id: string | null            // 저장된 이벤트 id (이미지 유형 지정용)
  title: string                // 실제 앱에 보이는 모임 제목
  candidate_id: string | null
  company_id: string
  company_name: string
  company_slug: string
  event_date: string // datetime-local
  source_url: string // 확인 링크
  location_region: string
  image_type_id: string | null // 상세페이지 상세설명 이미지 유형
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
  is_active: boolean      // 앱 노출 on/off
  is_featured: boolean    // 추천 지정
  source: 'crawl' | 'manual'
  price_detail: PriceDetail | null // 가격 티어(에모셔널오렌지 자동). 읽기전용 표시.
  saved: boolean
  saving: boolean
  // 탭(해야할것/완료) 분류를 로드 시점 상태로 '고정'. 입력 중 실시간 재분류로 행이 튀는 것 방지.
  // 완료 표시(테두리·체크)는 live isRowDone로 하되, 탭 이동은 새로고침 때만.
  wasDone?: boolean
}

// 완료 판정(순수): 가격(남|여) + 나이(남|여) 둘 다 있어야 완료. 나이 공란=미완료(오너 확인).
function rowIsDone(r: Row): boolean {
  return (
    (r.price_male.trim() !== '' || r.price_female.trim() !== '') &&
    (r.age_male.trim() !== '' || r.age_female.trim() !== '')
  )
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
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState<'todo' | 'done'>('todo') // 해야할 것 / 입력 완료
  const [rows, setRows] = useState<Row[]>([])
  // 펼친 행(해시태그·정원·삭제). 행마다 항상 펼쳐두면 화면이 태그 칩으로 뒤덮인다.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
      .select('id, title, image_type_id, company_id, event_date, source_url, location_region, capacity_male, seats_left_male, price_male, capacity_female, seats_left_female, price_female, price_detail, age_male, age_female, hashtags, is_closed, is_active, is_featured, source, companies(name, slug)')
      .gte('event_date', now.toISOString())
      .lte('event_date', horizon.toISOString())
      .order('company_id')
      .order('event_date')
    if (error) {
      // ⚠️ 세션이 없으면 프록시가 {"error":"unauthorized"}(401)를 주는데 message 필드가 없어
      //    "로딩 오류: undefined"만 떴다. 원인을 알 수 없는 메시지는 없느니만 못하다.
      const detail = (error as any)?.message || (error as any)?.error || JSON.stringify(error)
      const unauth = String(detail).includes('unauthorized') || (error as any)?.code === '401'
      setMsg(unauth ? '로그인이 필요합니다. 다시 로그인해 주세요.' : `로딩 오류: ${detail}`)
      setLoading(false)
      return
    }
    const s = (v: number | null) => (v == null ? '' : String(v))
    const evRows: Row[] = (data ?? []).map((e: any) => {
      const r = makeRow({
        id: e.id,
        title: e.title ?? '',
        image_type_id: e.image_type_id ?? null,
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
        is_active: e.is_active ?? true,
        is_featured: e.is_featured ?? false,
        source: e.source === 'crawl' ? 'crawl' : 'manual', // crawl=미입력(흰), 그외=오너입력(노랑)
      })
      return { ...r, wasDone: rowIsDone(r) } // 로드 시점 완료여부로 탭 고정
    })
    // 아직 저장 안 한 수동 추가 행(빈 source_url)은 보존
    setRows((prev) => [...prev.filter((r) => !r.source_url), ...evRows])
    setLoading(false)
  }

  // 모임명 키워드 검색 — 공백으로 나눠 전부 포함하는 행만(순서 무관).
  // 제목이 "[업체] [지역] 모임명" 구조라 "티키타카 수원" 처럼 조합해 찾을 수 있다.
  const searchedRows = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return rows
    return rows.filter((r) => {
      const company = companies.find((c) => c.id === r.company_id)?.name ?? ''
      const hay = `${r.title ?? ''} ${company}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }, [rows, search, companies])

  const visibleRows = useMemo(
    () => (filterCompany ? searchedRows.filter((r) => r.company_id === filterCompany) : searchedRows),
    [searchedRows, filterCompany],
  )

  // 업체별 건수 (탭 배지용) — 검색 중이면 검색 결과 기준이어야 한다.
  // 안 그러면 "265건 찾음"인데 탭엔 839가 떠서 화면이 어긋나 보인다.
  const companyCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of searchedRows) m[r.company_id] = (m[r.company_id] ?? 0) + 1
    return m
  }, [searchedRows])

  // 실제 삭제. ⚠️ 예전엔 화면에서 행만 걷어내(setRows filter) DB는 그대로였고,
  //    새로고침하면 되살아났다. 크롤로 다시 들어올 일정은 '앱 노출'을 끄는 게 맞고,
  //    삭제는 되돌릴 수 없으므로 한 번 확인한다.
  async function deleteRow(r: Row) {
    if (r.id) {
      if (!confirm(`이 일정을 삭제할까요?\n\n${r.title || r.source_url}\n\n크롤로 다시 들어올 수 있는 일정이면 삭제 대신 '앱 노출'을 끄는 편이 낫습니다.`)) return
      const { error } = await supabase.from('events').delete().eq('id', r.id)
      if (error) { setMsg(`삭제 실패: ${error.message}`); return }
      setMsg('삭제했습니다.')
    }
    setRows((rs) => rs.filter((x) => x.key !== r.key))
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

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
      // 실제 앱 제목 보존(크롤 제목). 수동 신규만 업체명 폴백. (예전엔 업체명으로 덮어써 제목 손상)
      title: row.title || row.company_name || '모임',
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
      // ⚠️ 예전엔 여기가 is_active: true 하드코딩이라, 앱 노출을 꺼도 그 행을 한 번만
      //    더 수정하면 도로 켜졌다. 화면 상태를 그대로 저장한다.
      is_active: row.is_active,
      is_featured: row.is_featured,
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

  // ⚠️ 탭 분류는 로드 시점 상태(wasDone)로 '고정' — 입력 중 완료로 바뀌어도 행이 목록에서
  //    사라지지 않게(포커스 튐 방지). 새로고침(재로드) 때 다시 분류된다.
  const todoRows = useMemo(() => visibleRows.filter((r) => !r.wasDone), [visibleRows])
  const doneRows = useMemo(() => visibleRows.filter((r) => r.wasDone), [visibleRows])
  const shownRows = statusTab === 'todo' ? todoRows : doneRows

  // ── 모바일 카드 한 장 렌더 ──
  // 카드도 노란 배경을 걷어냈다 — '해야할 것' 탭에선 전 카드가 노래서 구분이 안 됐다.
  // 미완료는 빈 칸의 테두리(fieldCls)로만 알린다.
  const renderCard = (r: Row) => (
    <div key={r.key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
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
        <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
          <input type="checkbox" checked={r.is_active}
            onChange={(e) => { patch(r.key, 'is_active', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
          앱 노출
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0">
          <input type="checkbox" checked={r.is_featured}
            onChange={(e) => { patch(r.key, 'is_featured', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
          추천
        </label>

      </div>

      {/* 앱에 보이는 모임 제목 (일시·지역보다 앞) */}
      {r.title && <p className="text-sm font-medium text-gray-800 mb-2.5 break-words">{r.title}</p>}

      {/* 상세페이지 상세설명 이미지 유형 (업체에 등록된 유형 있을 때만) */}

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
            className={fieldCls(r.location_region.trim() === '', 'w-full')} />
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

      {/* 크롤 가격 참고 — 가격이 빈 행에서만(입력 완료 카드에선 숨김, 높이 일정하게) */}
      {r.price_detail && (r.price_male.trim() === '' || r.price_female.trim() === '') && (
        <PriceDetailReadout detail={r.price_detail} />
      )}

      {/* 해시태그는 이 화면의 작업(가격·나이 검수)과 무관하고 칩이 화면을 뒤덮는다.
          완료 판정(rowIsDone)에도 안 들어간다 → 펼쳤을 때만 보여준다. */}
      <button onClick={() => toggleExpand(r.key)}
        className="mt-2.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
        {expanded.has(r.key) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        해시태그{r.hashtags.length > 0 && ` ${r.hashtags.length}`} · 정원 · 삭제
      </button>
      {expanded.has(r.key) && (
        <div className="mt-2 pt-2.5 border-t border-gray-100 space-y-3">
          <HashtagEditor value={r.hashtags} onChange={(next) => patchHashtags(r.key, next)} />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>정원 남 {r.capacity_male || '-'} · 여 {r.capacity_female || '-'}</span>
            <div className="flex-1" />
            <button onClick={() => deleteRow(r)}
              className="inline-flex items-center gap-1 text-gray-400 hover:text-red-500">
              <Trash2 size={13} /> 삭제
            </button>
          </div>
        </div>
      )}
    </div>
  )

  // ── 데스크탑 표 행 렌더(2행: 입력행 + 추천 해시태그행) ──
  const renderTableRow = (r: Row) => (
    <Fragment key={r.key}>
    {/* ⚠️ 행 전체를 노랗게 칠하던 것 제거 — '해야할 것' 탭에선 전 행이 노래서 정보량이 0이었다.
        미완료는 빈 '칸'의 테두리로만 알린다(fieldCls). */}
    <tr className="border-b border-gray-100">
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
        <span className="block truncate font-medium text-gray-800" title={r.company_name}>{r.company_name}</span>
      </td>
      <td className="px-3 py-2 max-w-0">
        <span className="block truncate text-gray-700" title={r.title}>{r.title}</span>
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

      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={r.is_closed} title="마감"
          onChange={(e) => { patch(r.key, 'is_closed', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
        <input type="checkbox" checked={r.is_active} title="앱 노출" className="ml-2"
          onChange={(e) => { patch(r.key, 'is_active', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
        <input type="checkbox" checked={r.is_featured} title="추천" className="ml-2"
          onChange={(e) => { patch(r.key, 'is_featured', e.target.checked); setTimeout(() => flushSave(r.key), 0) }} />
      </td>
      <td className="px-2 py-1.5 text-right">
        <button onClick={() => toggleExpand(r.key)} title="자세히"
          className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          {expanded.has(r.key) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </td>
    </tr>
    {/* 크롤이 뽑아온 가격 — 예전엔 모바일 카드에만 있어서, PC에선 답이 화면 밖에 있는 채로
        매번 원본 사이트를 새 탭으로 열어야 했다. 참고줄로 항상 보이게 한다. */}
    {/* ⚠️ 크롤값은 '채워 넣을 때 참고하는 값'이다. 이미 입력한 행에도 띄우면 행마다
        한 줄이 생겼다 말았다 해서 목록 높이가 들쭉날쭉해진다(2026-07-29 오너 지적).
        가격이 비어 있는 행에서만 보여준다 → 입력 완료 탭에서는 아예 안 나온다. */}
    {r.price_detail && (r.price_male.trim() === '' || r.price_female.trim() === '') && (
      <tr className="border-b border-gray-100">
        <td colSpan={12} className="px-3 pt-0 pb-1.5">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="text-gray-400 shrink-0">크롤값</span>
            <PriceDetailReadout detail={r.price_detail} />
          </div>
        </td>
      </tr>
    )}
    {expanded.has(r.key) && (
      <tr className="border-b border-gray-100 bg-gray-50/60">
        <td colSpan={12} className="px-3 py-3 whitespace-normal">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-400 shrink-0 pt-1.5 w-14">해시태그</span>
              <div className="min-w-0 flex-1">
                <HashtagEditor value={r.hashtags} onChange={(next) => patchHashtags(r.key, next)} />
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>정원 남 {r.capacity_male || '-'} · 여 {r.capacity_female || '-'}</span>
              <span>잔여 남 {r.seats_left_male || '-'} · 여 {r.seats_left_female || '-'}</span>
              <div className="flex-1" />
              <button onClick={() => deleteRow(r)}
                className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500">
                <Trash2 size={14} /> 삭제
              </button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </Fragment>
  )

  return (
    <div className="p-4 md:p-8 max-w-[1500px] min-w-0">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">일정 관리</h1>
        <p className="text-sm text-gray-500 mt-1">
          크롤링된 일정이 자동으로 올라옵니다. <b>[확인하기]</b>로 원본을 보고 가격·연령을 채우세요.
          <b>칸을 벗어나면 즉시 저장</b>됩니다. 비어 있는 칸은 테두리로 표시됩니다.
        </p>
      </div>

      {/* 모임명 검색 — 일정이 많아 탭만으로는 원하는 모임을 찾기 어렵다 */}
      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="모임명 검색 (예: 티키타카, 와인)"
            className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-pink-400"
          />
          {!!search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
              aria-label="검색어 지우기"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {!!search.trim() && (
          <p className="text-xs text-gray-500 mt-1.5">
            {visibleRows.length}건 찾음
          </p>
        )}
      </div>

      {/* 업체별 탭 — 담당자별로 자기 업체 탭만 보고 입력하도록 구분 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilterCompany('')}
          className={tabClass(filterCompany === '')}
        >
          전체 <span className="opacity-60">{searchedRows.length}</span>
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
        {/* 참고: patch()가 setRows(rs.map(...))로 배열을 통째로 새로 만들어 타이핑마다 전 행이
            다시 렌더된다. 다만 행당 렌더 비용의 대부분이던 추천칩(HashtagEditor 2개 ×
            칩 40여 개)을 펼침으로 옮겨 노드 수가 크게 줄었다. 그래도 느리면 그때 행
            컴포넌트를 memo로 격리할 것(핸들러 useCallback 정리가 함께 필요). */}
        {/* 모바일: 카드형 — 선택된 탭 목록만 표시 */}
        <div className="md:hidden space-y-3">
          {shownRows.map(renderCard)}
        </div>

        {/* 데스크탑: 표 */}
        {/* ⚠️ overflow-hidden 으로 뒀더니 폭이 모자랄 때 오른쪽 열(연령·토글·펼치기)이
            잘린 채 스크롤도 안 됐다(2026-07-29 오너 지적). 가로 스크롤을 되살리고,
            table-fixed + 열별 고정폭으로 제목이 남는 폭을 다 먹지 않게 한다. */}
        <div className="hidden md:block w-full max-w-full bg-white border border-gray-200 rounded-xl overflow-x-auto overflow-y-visible">
          <table className="w-full min-w-[1180px] table-fixed text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium w-[84px]">확인</th>
                <th className="px-1 py-2.5 w-7"></th>
                <th className="px-3 py-2.5 text-left font-medium w-[104px]">업체</th>
                <th className="px-3 py-2.5 text-left font-medium">제목</th>
                <th className="px-3 py-2.5 text-left font-medium w-[164px]">날짜/시간</th>
                <th className="px-3 py-2.5 text-left font-medium w-[92px]">지역</th>
                <th className="px-2 py-2.5 text-center font-medium text-blue-600 w-[104px]">남 가격</th>
                <th className="px-2 py-2.5 text-center font-medium text-blue-600 w-[92px]">남 연령</th>
                <th className="px-2 py-2.5 text-center font-medium text-pink-600 w-[104px]">여 가격</th>
                <th className="px-2 py-2.5 text-center font-medium text-pink-600 w-[92px]">여 연령</th>
                <th className="px-2 py-2.5 text-center font-medium w-[124px]">마감·노출·추천</th>
                <th className="px-2 py-2.5 w-[44px]"></th>
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

// 입력칸 공통 규격 — 높이 32px 고정. 컴포넌트마다 제각각이던 것을 하나로 묶는다.
// ⚠️ 힌트(년생)를 칸 아래 두면 그 행만 키가 커져 표가 들쭉날쭉해진다(오너 지적).
//    힌트는 칸 아래가 아니라 절대배치 툴팁 없이 '아래 여백을 차지하지 않는' 위치에 둔다.
const FIELD = 'h-8 border rounded-md px-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-pink-500/40'
// 값이 비었으면 테두리로 알린다. 행 전체를 칠하지 않고 '채워야 할 칸'만 짚어준다.
const fieldCls = (empty: boolean, extra = '') =>
  `${FIELD} ${empty ? 'border-amber-400' : 'border-gray-200'} ${extra}`

function NumCell({ value, onChange, onBlur, wide }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; wide?: boolean
}) {
  return (
    <td className="px-2 py-1.5">
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
        className={fieldCls(value.trim() === '', `text-right ${wide ? 'w-24' : 'w-16'}`)} />
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
        className={fieldCls(String(value).trim() === '', 'w-full text-center placeholder:text-gray-300')} />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5 text-center">{hint}</p>}
    </div>
  )
}

// 참가 연령대 — 사이트에서 본 그대로 자유 입력 (예: "27~34", "20대~30대 초반")
function AgeCell({ value, onChange, onBlur, hint }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; hint?: string | null
}) {
  return (
    <td className="px-2 py-1.5">
      <div className="relative w-[4.5rem]">
        <input value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          placeholder="예 2734"
          className={fieldCls(value.trim() === '', 'text-center w-full placeholder:text-gray-300')} />
        {/* 행 높이를 늘리지 않도록 흐름에서 빼서 칸 아래에 겹쳐 놓는다 */}
        {hint && (
          <span className="absolute left-0 right-0 -bottom-3 text-[10px] text-gray-400 text-center pointer-events-none">
            {hint}
          </span>
        )}
      </div>
    </td>
  )
}

// 만나이→출생연도(YY년생) 힌트 (오너 검증용, 작게 표시). frip 포함:
// frip은 참가연령이 대부분 '88~04년생' 등 년생 기반이라 년도 힌트가 맞음(제외 금지).
// 나이가 'NN~NN' 숫자범위일 때만 힌트가 뜸('2030' 밴드 등은 안 뜸 → 정상).
// twoyeonsi: 사이트가 '91-98년생'처럼 년생으로만 표기(만나이/세 표기 없음) → 힌트 필수.
// secretsalon: '87년생이하'와 '만30-39세'를 섞어 씀.
const BIRTH_YEAR_VENDORS = new Set([
  'yeonin', 'lovecommunity-loco', 'talkblossom', 'frip', 'modparty', 'munto',
  'twoyeonsi', 'secretsalon',
])
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
    id: null,
    title: '',
    image_type_id: null,
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
    is_active: true,
    is_featured: false,
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
