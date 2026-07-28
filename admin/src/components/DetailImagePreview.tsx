import { useEffect } from 'react'
import { X } from 'lucide-react'

const PHONE_W = 390 // 앱에서 보이는 폭에 맞춰 — 실제 사용자가 보는 크기로 확인하려고

/**
 * 상세 이미지 확대보기.
 *
 * admin 썸네일은 w-28 h-36 object-cover 라 세로로 긴 캡처가 잘려서, 제대로 올렸는지
 * 확인이 안 된다(원본이 1080×8689 같은 것도 있다). 그래서 **앱 상세화면과 같은 방식**으로
 * — 폰 폭에 맞춰 전체 폭, 원본 비율, 등록 순서대로 이어 붙여 — 보여준다.
 * 이미지 하나만 크게 보는 게 아니라 이어졌을 때 어색한 데가 없는지도 같이 봐야 하므로.
 */
export default function DetailImagePreview({
  typeName, images, startIndex = 0, onClose,
}: {
  typeName: string
  images: string[]
  startIndex?: number
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // 뒤 배경이 같이 스크롤되면 어디를 보는지 헷갈린다
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // 누른 이미지 위치로 스크롤
  useEffect(() => {
    if (!startIndex) return
    const el = document.getElementById(`preview-img-${startIndex}`)
    el?.scrollIntoView({ block: 'start' })
  }, [startIndex])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex flex-col items-center"
      onClick={onClose}
      role="dialog"
      aria-label={`${typeName} 상세 이미지 확대보기`}
    >
      <div className="w-full max-w-md flex items-center justify-between px-4 py-3 text-white shrink-0">
        <div className="min-w-0">
          <p className="font-semibold truncate">{typeName}</p>
          <p className="text-xs text-white/60">이미지 {images.length}장 · 앱에서 보이는 모습</p>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-sm shrink-0"
        >
          <X size={15} /> 닫기
        </button>
      </div>

      {/* 폰 폭으로 고정 — 실제 사용자가 보는 크기 그대로 확인 */}
      <div
        className="flex-1 w-full overflow-y-auto overscroll-contain pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto bg-white" style={{ width: '100%', maxWidth: PHONE_W }}>
          {images.map((url, i) => (
            <div key={url} id={`preview-img-${i}`} className="relative">
              {/* 앱과 동일: 전체 폭 + 원본 비율 + 이음새 없이 세로로 이어 붙임 */}
              <img src={url} alt={`${typeName} ${i + 1}번째`} className="w-full block" />
              <span className="absolute top-2 left-2 bg-black/55 text-white text-[11px] px-1.5 py-0.5 rounded">
                {i + 1} / {images.length}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
