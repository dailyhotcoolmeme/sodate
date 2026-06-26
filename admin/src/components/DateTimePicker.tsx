import { useEffect, useMemo, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react'

/**
 * 깔끔한 날짜/시간 선택기.
 * value = "YYYY-MM-DDTHH:mm" (datetime-local 과 동일 포맷), 빈 문자열이면 미선택.
 * 트리거 버튼을 누르면 달력 + 시간 선택 모달이 뜨고, [확인] 시 onChange + onCommit.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const MIN_STEPS = [0, 10, 20, 30, 40, 50]

type Parts = { y: number; mo: number; d: number; h: number; mi: number }

function parse(value: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toValue(p: Parts): string {
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}

function formatDisplay(value: string): string {
  const p = parse(value)
  if (!p) return ''
  const wd = WEEK[new Date(p.y, p.mo, p.d).getDay()]
  const ampm = p.h < 12 ? '오전' : '오후'
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${p.mo + 1}/${p.d}(${wd}) ${ampm} ${h12}:${pad(p.mi)}`
}

function defaultParts(): Parts {
  const n = new Date()
  return { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(), h: 19, mi: 0 }
}

export default function DateTimePicker({
  value,
  onChange,
  onCommit,
  fullWidth,
}: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  fullWidth?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Parts>(() => parse(value) ?? defaultParts())
  // 보고 있는 달(달력 네비게이션)
  const [view, setView] = useState(() => {
    const p = parse(value) ?? defaultParts()
    return { y: p.y, mo: p.mo }
  })

  // 모달 열 때 현재 값 기준으로 초기화
  useEffect(() => {
    if (open) {
      const p = parse(value) ?? defaultParts()
      setDraft(p)
      setView({ y: p.y, mo: p.mo })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const days = useMemo(() => {
    const first = new Date(view.y, view.mo, 1)
    const startPad = first.getDay()
    const total = new Date(view.y, view.mo + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < startPad; i++) cells.push(null)
    for (let d = 1; d <= total; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [view])

  const selected = parse(value)
  const display = formatDisplay(value)

  function moveMonth(delta: number) {
    setView((v) => {
      const m = v.mo + delta
      return { y: v.y + Math.floor(m / 12), mo: ((m % 12) + 12) % 12 }
    })
  }

  function confirm() {
    onChange(toValue(draft))
    setOpen(false)
    onCommit?.()
  }

  const ampm = draft.h < 12 ? 'AM' : 'PM'
  const h12 = draft.h % 12 === 0 ? 12 : draft.h % 12

  function setAmpm(next: 'AM' | 'PM') {
    setDraft((p) => {
      let h = p.h % 12 // 0~11 (12시간 기준 시분)
      if (next === 'PM') h += 12
      return { ...p, h }
    })
  }
  function setHour12(val: number) {
    setDraft((p) => {
      const base = p.h >= 12 ? 12 : 0
      const h = base + (val % 12)
      return { ...p, h }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${fullWidth ? 'flex w-full' : 'inline-flex'} items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-sm bg-white transition-colors ${
          display
            ? 'border-gray-200 text-gray-800 hover:border-pink-300'
            : 'border-dashed border-gray-300 text-gray-400 hover:border-pink-300'
        }`}
      >
        <Calendar size={14} className="text-pink-500" />
        {display || '날짜 선택'}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 달력 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={() => moveMonth(-1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-bold text-gray-900">{view.y}년 {view.mo + 1}월</span>
              <button type="button" onClick={() => moveMonth(1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* 요일 */}
            <div className="grid grid-cols-7 mb-1">
              {WEEK.map((w, i) => (
                <div key={w} className={`text-center text-xs py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{w}</div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((d, i) => {
                if (d == null) return <div key={i} />
                const isSel = selected && selected.y === view.y && selected.mo === view.mo && selected.d === d
                const isDraft = draft.y === view.y && draft.mo === view.mo && draft.d === d
                const dow = i % 7
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, y: view.y, mo: view.mo, d }))}
                    className={`h-9 rounded-lg text-sm font-medium transition-colors ${
                      isDraft
                        ? 'bg-pink-500 text-white'
                        : isSel
                        ? 'bg-pink-100 text-pink-700'
                        : `hover:bg-gray-100 ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-blue-500' : 'text-gray-700'}`
                    }`}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            {/* 시간 */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-gray-500">
                <Clock size={13} /> 시간
              </div>
              <div className="flex items-center gap-2">
                {/* 오전/오후 */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {(['AM', 'PM'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setAmpm(m)}
                      className={`px-2.5 py-1.5 rounded-md text-sm font-medium ${ampm === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                      {m === 'AM' ? '오전' : '오후'}
                    </button>
                  ))}
                </div>
                {/* 시 */}
                <select value={h12} onChange={(e) => setHour12(+e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>{h}시</option>
                  ))}
                </select>
                {/* 분 */}
                <select value={draft.mi} onChange={(e) => setDraft((p) => ({ ...p, mi: +e.target.value }))}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                  {(MIN_STEPS.includes(draft.mi) ? MIN_STEPS : [...MIN_STEPS, draft.mi].sort((a, b) => a - b)).map((m) => (
                    <option key={m} value={m}>{pad(m)}분</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 액션 */}
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setOpen(false)}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200">
                취소
              </button>
              <button type="button" onClick={confirm}
                className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-pink-500 hover:bg-pink-600">
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
