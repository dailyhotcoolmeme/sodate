import { useEffect, useRef, useState } from 'react'
import { eventsApi, type PartnerEvent, type EventInput } from '../lib/api'
import { uploadImage, deleteImage } from '../lib/upload'
import { CardPreview, DetailPreview, type PreviewData } from '../components/EventPreview'

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

/** 저장을 누른 뒤에야 "빠졌다"고 알려주지 않도록, 미리 표시해 둔다. */
function RequiredMark() {
  return <span className="text-pink-600 text-xs font-medium align-middle">필수</span>
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
  const [uploading, setUploading] = useState(false)
  const [previewTab, setPreviewTab] = useState<'card' | 'detail'>('card')
  // 저장한 뒤 "앱에 언제 올라가는지"를 알려주는 안내. 그동안 저장하면 폼만 닫혀서
  // 업체 입장에선 진짜 올라간 건지 확인할 방법이 없었다.
  const [justSaved, setJustSaved] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => eventsApi.list().then(setEvents).catch(() => setEvents([]))
  useEffect(() => {
    load()
  }, [])

  const startCreate = () => {
    setForm(EMPTY)
    setHashtagsText('')
    setError('')
    setJustSaved('')
    setPreviewTab('card')
    setEditingId('new')
  }

  const startEdit = (ev: PartnerEvent) => {
    setForm({ ...ev, event_date: toDatetimeLocal(ev.event_date) })
    setHashtagsText(ev.hashtags.join(', '))
    setError('')
    setJustSaved('')
    setPreviewTab('card')
    setEditingId(ev.id)
  }

  const handleFilePick = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    setError('')
    try {
      const urls: string[] = []
      for (const file of Array.from(files)) {
        urls.push(await uploadImage(file))
      }
      setForm((f) => ({ ...f, thumbnail_urls: [...f.thumbnail_urls, ...urls] }))
    } catch {
      setError('사진 업로드에 실패했습니다')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeImage = async (url: string) => {
    setForm((f) => ({ ...f, thumbnail_urls: f.thumbnail_urls.filter((u) => u !== url) }))
    deleteImage(url).catch(() => {})
  }

  const handleSave = async () => {
    if (!form.title.trim()) return setError('모임 제목을 적어주세요. 앱 목록에 그대로 보이는 이름입니다.')
    if (!form.event_date) return setError('모임 날짜와 시작 시간을 골라주세요.')
    if (!form.location_region.trim()) return setError('지역을 적어주세요. 이용자가 지역으로 찾습니다.')

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
      setJustSaved(editingId === 'new' ? '등록' : '수정')
      load()
    } catch {
      setError('저장에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (ev: PartnerEvent) => {
    if (!confirm(`'${ev.title}' 일정을 삭제할까요?\n삭제하면 앱에서도 바로 사라지고, 되돌릴 수 없습니다.`)) return
    await eventsApi.remove(ev.id)
    setJustSaved('')
    load()
  }

  const numberField = (v: string): number | null => (v.trim() === '' ? null : Number(v))

  const previewData: PreviewData = {
    title: form.title,
    description: form.description ?? '',
    imageUrl: form.thumbnail_urls[0] ?? null,
    eventDate: form.event_date ? new Date(form.event_date).toISOString() : '',
    region: form.location_region,
    priceMale: form.price_male == null ? '' : String(form.price_male),
    priceFemale: form.price_female == null ? '' : String(form.price_female),
    hashtags: hashtagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">일정 관리</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            여기서 등록하신 일정은 저장하는 즉시 모잇 앱에 올라갑니다. 직접 올리신 일정에는{' '}
            <b className="text-pink-600">모잇 Pick</b> 표시가 붙어 이용자 눈에 더 띕니다.
          </p>
        </div>
        {editingId === null && (
          <button
            onClick={startCreate}
            className="shrink-0 px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600"
          >
            + 새 일정 등록
          </button>
        )}
      </div>

      {justSaved && editingId === null && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm text-green-800">
            {justSaved}됐습니다. 모잇 앱에 바로 올라갔습니다.
          </p>
        </div>
      )}

      {editingId !== null && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 왼쪽: 입력 폼 */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                {editingId === 'new' ? '새 일정 등록' : '일정 수정'}
              </h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                적으시는 대로 오른쪽 미리보기가 바뀝니다. 실제 앱에 보이는 모습 그대로예요.
                <br />
                <span className="text-pink-600 font-medium">필수</span> 표시가 있는 칸만 채우시면 저장할 수 있습니다.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">사진</label>
              <p className="text-xs text-gray-400 mb-2">
                첫 번째 사진이 앱 목록에 보이는 대표 사진입니다. 여러 장 올리셔도 됩니다.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.thumbnail_urls.map((url) => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                    <button
                      onClick={() => removeImage(url)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-800 text-white text-xs flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-xs flex items-center justify-center hover:border-pink-400 hover:text-pink-500 disabled:opacity-50"
                >
                  {uploading ? '올리는 중' : '+ 추가'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilePick(e.target.files)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                모임 제목 <RequiredMark />
              </label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="예: 강남 로테이션 소개팅"
              />
              <p className="text-xs text-gray-400 mt-1">앱 목록에 그대로 보이는 이름입니다.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">세부 설명</label>
              <textarea
                value={form.description ?? ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
                placeholder={
                  '어떤 모임인지, 어떻게 진행되는지 적어주세요.\n예) 3:3 로테이션으로 진행되며, 음료 1잔이 포함됩니다. 편한 복장으로 오세요.'
                }
              />
              <p className="text-xs text-gray-400 mt-1">
                이용자가 신청을 결정할 때 가장 많이 읽는 곳입니다. 진행 방식·준비물·주의사항을 적어주세요.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  날짜·시작 시간 <RequiredMark />
                </label>
                <input
                  type="datetime-local"
                  value={form.event_date}
                  onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  지역 <RequiredMark />
                </label>
                <input
                  value={form.location_region}
                  onChange={(e) => setForm({ ...form, location_region: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="예: 강남"
                />
                <p className="text-xs text-gray-400 mt-1">이용자가 지역으로 찾습니다.</p>
              </div>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">남성 참가비 (원)</label>
                  <input
                    type="number"
                    value={form.price_male ?? ''}
                    onChange={(e) => setForm({ ...form, price_male: numberField(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="예: 30000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">여성 참가비 (원)</label>
                  <input
                    type="number"
                    value={form.price_female ?? ''}
                    onChange={(e) => setForm({ ...form, price_female: numberField(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="예: 25000"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">비워두시면 앱에 참가비가 표시되지 않습니다.</p>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">남성 정원 (명)</label>
                  <input
                    type="number"
                    value={form.capacity_male ?? ''}
                    onChange={(e) => setForm({ ...form, capacity_male: numberField(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="예: 4"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">여성 정원 (명)</label>
                  <input
                    type="number"
                    value={form.capacity_female ?? ''}
                    onChange={(e) => setForm({ ...form, capacity_female: numberField(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="예: 4"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">비워두시면 앱에 정원이 표시되지 않습니다.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">해시태그</label>
              <input
                value={hashtagsText}
                onChange={(e) => setHashtagsText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="예: 20대, 직장인, 강남"
              />
              <p className="text-xs text-gray-400 mt-1">
                쉼표(,)로 나눠서 적어주세요. 이용자가 검색으로 찾을 때 쓰입니다.
              </p>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600 disabled:opacity-60"
              >
                {saving ? '저장 중...' : editingId === 'new' ? '등록하고 앱에 올리기' : '수정 내용 저장'}
              </button>
              <button
                onClick={() => setEditingId(null)}
                className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>

          {/* 오른쪽: 실시간 미리보기 */}
          <div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setPreviewTab('card')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  previewTab === 'card' ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                목록에서 보이는 모습
              </button>
              <button
                onClick={() => setPreviewTab('detail')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  previewTab === 'detail' ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}
              >
                눌렀을 때 보이는 모습
              </button>
            </div>
            <div className="sticky top-4 max-w-sm mx-auto">
              {previewTab === 'card' ? <CardPreview data={previewData} /> : <DetailPreview data={previewData} />}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {events === null && <p className="text-sm text-gray-400">불러오는 중...</p>}
        {events?.length === 0 && editingId === null && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm font-semibold text-gray-700 mb-1">아직 등록하신 일정이 없습니다</p>
            <p className="text-sm text-gray-400 leading-relaxed">
              위 '새 일정 등록' 버튼을 눌러 첫 모임을 올려보세요.
            </p>
          </div>
        )}
        {events !== null && events.length > 0 && (
          <p className="text-xs text-gray-400 pt-2">앱에 올라가 있는 일정 {events.length}건</p>
        )}
        {events?.map((ev) => (
          <div
            key={ev.id}
            className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-4"
          >
            <div className="min-w-0 flex items-center gap-3">
              {ev.thumbnail_urls[0] && (
                <img src={ev.thumbnail_urls[0]} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{ev.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(ev.event_date).toLocaleString('ko-KR')} · {ev.location_region}
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => startEdit(ev)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                수정
              </button>
              <button
                onClick={() => handleDelete(ev)}
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
