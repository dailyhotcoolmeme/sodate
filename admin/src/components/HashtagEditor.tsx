import { useState, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// 추천 해시태그 사전 — admin 입력 보조용 (섹션별 그룹)
// 크롤러(crawler/utils/hashtags.py)·앱(app/constants/hashtags.ts)과 같은 어휘를 유지한다.
// 제외: #로테이션(보편어), #티키타카(특정 업체 모임명)
export const HASHTAG_SUGGESTIONS = [
  // 컨셉
  '#가치관팅', '#심리팅', '#이미지팅', '#에세이팅', '#블라인드', '#호감투표', '#사주·타로', '#와인', '#커피미팅', '#하이볼·위스키', '#술무제한', '#파티', '#야장·루프탑',
  // 형식
  '#1:1', '#2:2', '#4:4', '#6:6', '#7:7', '#10:10', '#12:12', '#15:15', '#소규모', '#개인룸',
  // 대상
  '#직장인', '#돌싱', '#결정사급', '#결혼전제', '#검증모임', '#키조건', '#프리미엄', '#전문직', '#대기업', '#공기업', '#외국계', '#공무원', '#교사', '#무자녀', '#비흡연', '#크리스천',
  // 연령
  '#20대', '#30대', '#40대',
]

// 입력값 정규화: 공백 트림 + 앞에 # 자동 부착
export function normalizeHashtag(raw: string): string {
  let t = raw.trim().replace(/\s+/g, '')
  if (!t) return ''
  t = t.replace(/^#+/, '')
  if (!t) return ''
  return `#${t}`
}

export default function HashtagEditor({ value, onChange, showInput = true, showSuggestions = true, compact = false, extraSuggestions = [] }: {
  value: string[]
  onChange: (next: string[]) => void
  showInput?: boolean       // false면 선택칩+입력창을 렌더하지 않음 (추천만)
  showSuggestions?: boolean  // false면 추천 태그를 렌더하지 않음 (입력만)
  compact?: boolean          // true면 다른 표 입력칸과 높이를 맞춤(py-1)
  // 사전 외에 '이미 쓰이고 있는 태그'(유형·일정에 등록된 것)를 후보에 합친다.
  // #직장인/#직장검증처럼 표기가 갈라지면 태그 필터가 안 묶이므로, 입력 중에
  // 기존 표기를 보여줘 같은 걸 고르게 한다(2026-07-30 오너 요청).
  extraSuggestions?: string[]
}) {
  const [input, setInput] = useState('')
  // 미리보기(추천) 칩을 누르는 중인지. 누르는 순간 입력칸이 포커스를 잃어 onBlur 가
  // 먼저 실행되면, 치던 글자('직')가 태그로 확정되고 그 자리에서 후보 목록이 사라져
  // 클릭이 완결되지 못한다 → '직장인'을 골랐는데 '직'이 박혔다(2026-07-30 오너 지적).
  const pickingRef = useRef(false)
  // 순서를 옮기려고 '집어든' 태그. null 이면 평상시 모습(이동 버튼 숨김).
  const [picked, setPicked] = useState<string | null>(null)

  const addTag = (raw: string) => {
    const tag = normalizeHashtag(raw)
    if (!tag) return
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) return
    onChange([...value, tag])
  }

  const commitInput = () => {
    if (!input.trim()) return
    addTag(input)
    setInput('')
  }

  const removeTag = (tag: string) => {
    if (picked === tag) setPicked(null)
    onChange(value.filter((t) => t !== tag))
  }

  // 순서 바꾸기: 칩을 한 번 누르면 '집힌' 상태가 되고 양옆 이동 버튼이 나온다.
  // 지우고 다시 입력하지 않고도 자리를 옮길 수 있다(오너 요청 2026-07-30).
  // 드래그 대신 버튼을 쓴 이유 — 이 칸은 가로로 스크롤되는 좁은 칸이라
  // 모바일에서 끌기와 스크롤이 서로 걸린다.
  const move = (tag: string, dir: -1 | 1) => {
    const i = value.indexOf(tag)
    const j = i + dir
    if (i < 0 || j < 0 || j >= value.length) return
    const next = [...value]
    next[i] = next[j]
    next[j] = tag
    onChange(next)
  }

  // 후보 풀 = 기본 사전 + 실사용 태그(중복 제거, 사전 순서 우선)
  const pool = [...HASHTAG_SUGGESTIONS, ...extraSuggestions].filter(
    (tag, i, arr) => arr.findIndex((x) => x.toLowerCase() === tag.toLowerCase()) === i
  )
  const notSelected = pool.filter(
    (s) => !value.some((t) => t.toLowerCase() === s.toLowerCase())
  )
  // 입력 중이면 입력값이 들어간 후보만(자동완성). 입력이 비면 전체 후보.
  const q = input.trim().replace(/^#+/, '').toLowerCase()
  // ⚠️ 입력이 비어 있으면 후보를 안 깔아둔다(오너 확정 2026-07-30). 예전엔 30여 개
  //    회색 칩이 상시 깔려 화면을 먹었다. 자동완성이 생긴 뒤로는 글자를 치면
  //    관련된 것만 뜨므로 상시 노출은 불필요.
  const remaining = q ? notSelected.filter((s) => s.toLowerCase().includes(q)) : []

  return (
    <div>
      {/* 선택된 칩 + 입력 */}
      {showInput && (
      <div className={`flex flex-nowrap items-center gap-1.5 w-full px-2 border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-pink-500 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${compact ? 'py-1 rounded' : 'py-2 rounded-lg'}`}>
        {value.map((tag, i) => {
          const on = picked === tag
          return (
          <span
            key={tag}
            className={`shrink-0 flex items-center gap-1 py-0.5 rounded-full text-xs font-medium ${on ? 'pl-1 pr-1 bg-pink-100 text-pink-700 ring-1 ring-pink-400' : 'pl-2 pr-1 bg-pink-50 text-pink-600'}`}
          >
            {on && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => move(tag, -1)}
                disabled={i === 0}
                className="disabled:opacity-25 hover:text-pink-900"
                aria-label={`${tag} 앞으로 옮기기`}
                title="앞으로"
              >
                <ChevronLeft size={13} />
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPicked(on ? null : tag)}
              className="font-medium"
              aria-label={on ? `${tag} 순서 바꾸기 끝내기` : `${tag} 순서 바꾸기`}
              title={on ? '순서 바꾸기 끝내기' : '눌러서 순서 바꾸기'}
            >
              {tag}
            </button>
            {on && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => move(tag, 1)}
                disabled={i === value.length - 1}
                className="disabled:opacity-25 hover:text-pink-900"
                aria-label={`${tag} 뒤로 옮기기`}
                title="뒤로"
              >
                <ChevronRight size={13} />
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => removeTag(tag)}
              className="hover:text-pink-800"
              aria-label={`${tag} 삭제`}
            >
              <X size={12} />
            </button>
          </span>
          )
        })}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              commitInput()
            } else if (e.key === 'Backspace' && !input && value.length > 0) {
              removeTag(value[value.length - 1])
            }
          }}
          onFocus={() => { pickingRef.current = false; setPicked(null) }}
          onBlur={() => {
            // 추천 칩을 누르는 중이면 치던 글자를 확정하지 않는다.
            if (pickingRef.current) return
            commitInput()
          }}
          placeholder={value.length === 0 ? '태그 입력 후 Enter (예: 와인)' : '추가...'}
          className="shrink-0 flex-1 min-w-24 text-sm focus:outline-none py-0.5 bg-transparent"
        />
      </div>
      )}

      {/* 추천 태그 */}
      {showSuggestions && remaining.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${showInput ? 'mt-2' : ''}`}>
          {remaining.map((s) => (
            <button
              key={s}
              type="button"
              // mousedown 기본동작(포커스 이동)을 막아 onBlur 자체가 안 일어나게 한다.
              // 터치 기기용으로 플래그도 함께 세운다.
              onMouseDown={(e) => { e.preventDefault(); pickingRef.current = true }}
              onTouchStart={() => { pickingRef.current = true }}
              onClick={() => { addTag(s); setInput(''); pickingRef.current = false }}
              className="px-2 py-0.5 rounded-full border border-gray-200 text-gray-500 text-xs hover:border-pink-300 hover:text-pink-500"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
