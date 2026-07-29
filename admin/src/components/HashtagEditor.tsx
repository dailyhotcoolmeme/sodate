import { useState } from 'react'
import { X } from 'lucide-react'

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

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag))

  // 후보 풀 = 기본 사전 + 실사용 태그(중복 제거, 사전 순서 우선)
  const pool = [...HASHTAG_SUGGESTIONS, ...extraSuggestions].filter(
    (tag, i, arr) => arr.findIndex((x) => x.toLowerCase() === tag.toLowerCase()) === i
  )
  const notSelected = pool.filter(
    (s) => !value.some((t) => t.toLowerCase() === s.toLowerCase())
  )
  // 입력 중이면 입력값이 들어간 후보만(자동완성). 입력이 비면 전체 후보.
  const q = input.trim().replace(/^#+/, '').toLowerCase()
  const remaining = q ? notSelected.filter((s) => s.toLowerCase().includes(q)) : notSelected

  return (
    <div>
      {/* 선택된 칩 + 입력 */}
      {showInput && (
      <div className={`flex flex-nowrap items-center gap-1.5 w-full px-2 border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-pink-500 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${compact ? 'py-1 rounded' : 'py-2 rounded-lg'}`}>
        {value.map((tag) => (
          <span key={tag} className="shrink-0 flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-pink-50 text-pink-600 text-xs font-medium">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:text-pink-800"
              aria-label={`${tag} 삭제`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
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
          onBlur={commitInput}
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
              onClick={() => { addTag(s); setInput('') }}
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
