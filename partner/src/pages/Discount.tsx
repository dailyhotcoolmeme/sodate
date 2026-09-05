import { useEffect, useState } from 'react'
import { discountApi } from '../lib/api'
import { INPUT, LABEL, HINT, BTN_PRIMARY, PANEL, H1, SUBTITLE } from '../lib/ui'

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
      <h1 className={H1}>할인 혜택 관리</h1>
      <p className={`${SUBTITLE} mt-2 mb-7`}>
        모잇을 보고 찾아온 이용자에게 드리는 혜택을 적어주세요. 적으신 문구가 앱 상세 화면에 그대로 보입니다.
      </p>

      <div className={`${PANEL} p-6`}>
        <label className={LABEL}>혜택 문구</label>
        <p className="text-xs text-ink-faint mb-2.5 leading-relaxed">
          이용자가 읽는 문장 그대로 적어주세요. 조건이 있다면 같이 적어주시는 게 좋습니다.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!loaded}
          rows={3}
          maxLength={200}
          placeholder="예: 모잇 보고 오셨다고 말씀해주시면 5,000원 할인해드립니다"
          className={`${INPUT} resize-none`}
        />
        <p className={HINT}>{value.length}/200자 · 비워두시면 앱에 혜택이 표시되지 않습니다.</p>

        <div className="flex items-center gap-3 mt-5">
          <button onClick={handleSave} disabled={!loaded || saving} className={BTN_PRIMARY}>
            {saving ? '저장 중...' : '저장'}
          </button>
          {saved && <span className="text-sm text-accent">저장됐습니다. 앱에 바로 반영됐습니다.</span>}
        </div>
      </div>
    </div>
  )
}
