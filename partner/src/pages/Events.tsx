import { useEffect, useState } from 'react'
import { eventsApi, type PartnerEvent, type EventInput } from '../lib/api'

const EMPTY: EventInput = {
  title: '',
  description: '',
  thumbnail_urls: [],
  event_date: '',
  location_region: '',
  price_male: null,
  price_female: null,
  capacity_male: null,
  capacity_female: null,
  hashtags: [],
}

function toDatetimeLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function Events() {
  const [events, setEvents] = useState<PartnerEvent[] | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<EventInput>(EMPTY)
  const [hashtagsText, setHashtagsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () => eventsApi.list().then(setEvents).catch(() => setEvents([]))
  useEffect(() => {
    load()
  }, [])

  const startCreate = () => {
    setForm(EMPTY)
    setHashtagsText('')
    setError('')
    setEditingId('new')
  }

  const startEdit = (ev: PartnerEvent) => {
    setForm({ ...ev, event_date: toDatetimeLocal(ev.event_date) })
    setHashtagsText(ev.hashtags.join(', '))
    setError('')
    setEditingId(ev.id)
  }

  const handleSave = async () => {
    if (!form.title.trim()) return setError('모임 제목을 입력해주세요')
    if (!form.event_date) return setError('날짜·시간을 입력해주세요')
    if (!form.location_region.trim()) return setError('지역을 입력해주세요')

    const payload: EventInput = {
      ...form,
      event_date: new Date(form.event_date).toISOString(),
      hashtags: hashtagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }

    setSaving(true)
    setError('')
    try {
      if (editingId === 'new') {
        await eventsApi.create(payload)
      } else if (editingId) {
        await eventsApi.update(editingId, payload)
      }
      setEditingId(null)
      load()
    } catch {
      setError('저장에 실패했습니다. 잠시 후 다시 시도해주세요')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('이 일정을 삭제할까요?')) return
    await eventsApi.remove(id)
    load()
  }

  const numberField = (v: string): number | null => (v.trim() === '' ? null : Number(v))

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">일정 관리</h1>
          <p className="text-sm text-gray-500">
            직접 등록한 일정에는 앱에서 <b className="text-pink-600">모잇 Pick</b> 배지가 붙습니다.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startCreate}
            className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600"
          >
            + 새 일정 등록
          </button>
        )}
      </div>

      {editingId !== null && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-900">
            {editingId === 'new' ? '새 일정 등록' : '일정 수정'}
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">모임 제목</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="예: 강남 로테이션 소개팅"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">세부 설명</label>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">날짜·시간</label>
              <input
                type="datetime-local"
                value={form.event_date}
                onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">지역</label>
              <input
                value={form.location_region}
                onChange={(e) => setForm({ ...form, location_region: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="예: 강남"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">남성 참가비(원)</label>
              <input
                type="number"
                value={form.price_male ?? ''}
                onChange={(e) => setForm({ ...form, price_male: numberField(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">여성 참가비(원)</label>
              <input
                type="number"
                value={form.price_female ?? ''}
                onChange={(e) => setForm({ ...form, price_female: numberField(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">남성 정원</label>
              <input
                type="number"
                value={form.capacity_male ?? ''}
                onChange={(e) => setForm({ ...form, capacity_male: numberField(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">여성 정원</label>
              <input
                type="number"
                value={form.capacity_female ?? ''}
                onChange={(e) => setForm({ ...form, capacity_female: numberField(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">해시태그 (쉼표로 구분)</label>
            <input
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="예: 20대, 직장인, 강남"
            />
          </div>

          <p className="text-xs text-gray-400">
            사진 첨부·실시간 미리보기는 다음 업데이트에서 추가됩니다.
          </p>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-60"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50"
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {events === null && <p className="text-sm text-gray-400">불러오는 중...</p>}
        {events?.length === 0 && (
          <p className="text-sm text-gray-400">아직 등록한 일정이 없습니다.</p>
        )}
        {events?.map((ev) => (
          <div
            key={ev.id}
            className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(ev.event_date).toLocaleString('ko-KR')} · {ev.location_region}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => startEdit(ev)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                수정
              </button>
              <button
                onClick={() => handleDelete(ev.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
