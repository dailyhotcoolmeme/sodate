import { useEffect, useState } from 'react'
import { discountApi } from '../lib/api'

export default function Discount() {
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    discountApi.get().then((v) => {
      setValue(v)
      setLoaded(true)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await discountApi.set(value)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">제휴 할인 관리</h1>
      <p className="text-sm text-gray-500 mb-6">
        모잇을 통해 신청·방문한 이용자에게 드리는 혜택을 적어주세요. 앱 상세 화면에 그대로 노출됩니다.
      </p>

      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">할인 문구</label>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!loaded}
          rows={3}
          maxLength={200}
          placeholder="예: 5,000원 할인 / 웰컴 드링크 1잔 서비스"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">{value.length}/200 · 비워두면 앱에서 혜택 줄이 안 보입니다</p>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={!loaded || saving}
            className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-60"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          {saved && <span className="text-sm text-green-600">저장됐습니다</span>}
        </div>
      </div>
    </div>
  )
}
