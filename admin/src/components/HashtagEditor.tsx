import { useState } from 'react'
import { X } from 'lucide-react'

// 추천 해시태그 사전 — admin 입력 보조용 (섹션별 그룹)
export const HASHTAG_SUGGESTIONS = [
  // 컨셉
  '#와인', '#요리', '#보드게임', '#등산·아웃도어', '#전시·문화', '#가치관팅', '#사주·타로', '#독서', '#대화중심', '#프리미엄', '#결혼전제',
  // 형식
  '#1:1', '#2:2', '#소규모', '#커피미팅', '#식사모임', '#사회자진행',
  // 대상
  '#직장인', '#전문직', '#대기업', '#공무원', '#교사',
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

export default function HashtagEditor({ value, onChange, showInput = true, showSuggestions = true, compact = false }: {
  value: string[]
  onChange: (next: string[]) => void
  showInput?: boolean       // false면 선택칩+입력창을 렌더하지 않음 (추천만)
  showSuggestions?: boolean  // false면 추천 태그를 렌더하지 않음 (입력만)
  compact?: boolean          // true면 다른 표 입력칸과 높이를 맞춤(py-1)
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

  const remaining = HASHTAG_SUGGESTIONS.filter(
    (s) => !value.some((t) => t.toLowerCase() === s.toLowerCase())
  )

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
              onClick={() => addTag(s)}
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
