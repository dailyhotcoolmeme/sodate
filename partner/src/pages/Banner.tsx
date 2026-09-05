import { useEffect, useRef, useState } from 'react'
import { bannerApi, type BannerRow } from '../lib/api'
import { uploadImage } from '../lib/upload'

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
      const updated = await bannerApi.set(url)
      setBanner(updated)
    } catch {
      setError('업로드에 실패했습니다')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">배너 광고</h1>
      <p className="text-sm text-gray-500 mb-6">
        유료 제휴 업체 전용 메뉴입니다. 이미지를 올리면 오너 검수 후 커뮤니티 화면 상단에 노출됩니다.
      </p>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        {banner === undefined ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : (
          <>
            {banner && (
              <div className="mb-4">
                <img src={banner.image_url} alt="배너 미리보기" className="w-full rounded-xl border border-gray-200" />
                <p className="text-xs mt-2">
                  상태:{' '}
                  {banner.is_active ? (
                    <span className="text-green-600 font-semibold">노출 중</span>
                  ) : (
                    <span className="text-amber-600 font-semibold">오너 검수 대기 중</span>
                  )}
                </p>
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-60"
            >
              {uploading ? '업로드 중...' : banner ? '배너 이미지 교체' : '배너 이미지 올리기'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePick(e.target.files)}
            />
            {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
            <p className="text-xs text-gray-400 mt-3">
              이미지를 새로 올리면 다시 검수 대기 상태가 됩니다.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
