import { useEffect, useRef, useState } from 'react'
import { bannerApi, type BannerRow } from '../lib/api'
import { uploadImage } from '../lib/upload'
import { BTN_PRIMARY, H1, SUBTITLE } from '../lib/ui'

export default function Banner() {
  const [banner, setBanner] = useState<BannerRow | null | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bannerApi.get().then(setBanner)
  }, [])

  const handlePick = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const url = await uploadImage(file)
      setBanner(await bannerApi.set(url))
    } catch {
      setError('업로드에 실패했습니다.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className={H1}>배너 광고</h1>
      <p className={`${SUBTITLE} mt-2 mb-7`}>
        앱 커뮤니티 화면 위쪽에 걸리는 배너입니다. 이미지를 올리시면 모잇에서 확인한 뒤 노출해드립니다.
        <br />
        가로로 긴 이미지(가로:세로 = 4:1)가 가장 잘 맞습니다.
      </p>

      {/* 유료 제휴 전용 자리라, 소개페이지의 유료 카드와 같은 분홍 테두리를 쓴다. */}
      <div className="panel-paid rounded-3xl p-6">
        {banner === undefined ? (
          <p className="text-sm text-ink-faint">불러오는 중...</p>
        ) : (
          <>
            {banner && (
              <div className="mb-5">
                <img
                  src={banner.image_url}
                  alt="지금 등록된 배너"
                  className="w-full rounded-2xl border border-line"
                />
                <p className="text-xs mt-3">
                  {banner.is_active ? (
                    <span className="text-accent font-semibold">지금 앱에 노출되고 있습니다</span>
                  ) : (
                    <span className="text-primary font-semibold">
                      모잇에서 확인 중입니다 — 확인이 끝나면 앱에 올라갑니다
                    </span>
                  )}
                </p>
              </div>
            )}
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={BTN_PRIMARY}>
              {uploading ? '업로드 중...' : banner ? '배너 이미지 교체' : '배너 이미지 올리기'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePick(e.target.files)}
            />
            {error && <p className="text-sm text-danger mt-3">{error}</p>}
            <p className="text-xs text-ink-faint mt-4 leading-relaxed">
              이미지를 새로 올리시면 모잇에서 한 번 더 확인한 뒤 노출됩니다. 그동안은 이전 배너가 내려갑니다.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
