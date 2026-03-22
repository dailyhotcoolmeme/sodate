import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, Pencil, Trash2, Eye, EyeOff, Star } from 'lucide-react'

interface Event {
  id: string; title: string; company_id: string
  event_date: string; location_region: string
  price_male: number | null; price_female: number | null
  is_active: boolean; is_closed: boolean; is_featured: boolean
  companies: { name: string } | null
}

export default function Events() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<Event | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, company_id, event_date, location_region, price_male, price_female, is_active, is_closed, is_featured, companies(name)')
      .order('event_date', { ascending: false })
      .limit(200)
    if (error) {
      // is_featured 컬럼 없을 경우 fallback
      const { data: data2 } = await supabase
        .from('events')
        .select('id, title, company_id, event_date, location_region, price_male, price_female, is_active, is_closed, companies(name)')
        .order('event_date', { ascending: false })
        .limit(200)
      setEvents((data2 as any) ?? [])
    } else {
      setEvents((data as any) ?? [])
    }
    setLoading(false)
  }

  async function toggleActive(id: string, current: boolean) {
    await supabase.from('events').update({ is_active: !current }).eq('id', id)
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, is_active: !current } : e))
  }

  async function toggleFeatured(id: string, current: boolean) {
    await supabase.from('events').update({
      is_featured: !current,
      featured_until: !current ? new Date(Date.now() + 30 * 864e5).toISOString() : null,
    }).eq('id', id)
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, is_featured: !current } : e))
  }

  async function deleteEvent(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    await supabase.from('events').delete().eq('id', id)
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  const filtered = events.filter((e) =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    (e.companies?.name ?? '').includes(search)
  )

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">이벤트 관리 <span className="text-base font-normal text-gray-400">({events.length}개)</span></h1>
        <button
          onClick={() => { setEditTarget(null); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-pink-500 text-white rounded-lg text-sm font-medium hover:bg-pink-600"
        >
          <Plus size={15} /> 수동 추가
        </button>
      </div>

      {/* 검색 */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="제목 또는 업체명 검색..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">업체</th>
                <th className="px-4 py-3 text-left font-medium">제목</th>
                <th className="px-4 py-3 text-left font-medium">날짜</th>
                <th className="px-4 py-3 text-left font-medium">지역</th>
                <th className="px-4 py-3 text-left font-medium">가격</th>
                <th className="px-4 py-3 text-center font-medium">노출</th>
                <th className="px-4 py-3 text-center font-medium">추천</th>
                <th className="px-4 py-3 text-center font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{event.companies?.name}</td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="truncate font-medium text-gray-900">{event.title}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(event.event_date).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{event.location_region}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {event.price_male ? `남 ${event.price_male.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(event.id, event.is_active)}>
                      {event.is_active
                        ? <Eye size={15} className="text-green-500 mx-auto" />
                        : <EyeOff size={15} className="text-gray-300 mx-auto" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleFeatured(event.id, event.is_featured)}>
                      <Star size={15} className={`mx-auto ${event.is_featured ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-center">
                      <button onClick={() => { setEditTarget(event); setShowForm(true) }}>
                        <Pencil size={14} className="text-gray-400 hover:text-blue-500" />
                      </button>
                      <button onClick={() => deleteEvent(event.id)}>
                        <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <EventForm
          initial={editTarget}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load() }}
        />
      )}
    </div>
  )
}

function EventForm({ initial, onClose, onSaved }: {
  initial: Event | null
  onClose: () => void
  onSaved: () => void
}) {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({
    company_id: initial?.company_id ?? '',
    title: initial?.title ?? '',
    event_date: initial ? initial.event_date.slice(0, 16) : '',
    location_region: initial?.location_region ?? '',
    price_male: initial?.price_male ?? '',
    price_female: initial?.price_female ?? '',
    source_url: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('companies').select('id, name').then(({ data }) => setCompanies(data ?? []))
  }, [])

  const save = async () => {
    setSaving(true)
    const payload: any = {
      ...form,
      price_male: form.price_male ? Number(form.price_male) : null,
      price_female: form.price_female ? Number(form.price_female) : null,
      event_date: new Date(form.event_date).toISOString(),
    }
    if (initial) {
      await supabase.from('events').update(payload).eq('id', initial.id)
    } else {
      await supabase.from('events').insert({ ...payload, source_url: form.source_url || 'manual' })
    }
    setSaving(false)
    onSaved()
  }

  const fields: [string, string, string][] = [
    ['제목', 'title', 'text'],
    ['날짜/시간', 'event_date', 'datetime-local'],
    ['지역', 'location_region', 'text'],
    ['남성 가격', 'price_male', 'number'],
    ['여성 가격', 'price_female', 'number'],
    ['신청 URL', 'source_url', 'url'],
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-bold">{initial ? '이벤트 수정' : '이벤트 수동 추가'}</h2>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">업체</label>
          <select
            value={form.company_id}
            onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">선택...</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {fields.map(([label, key, type]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
            <input
              type={type}
              value={(form as any)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
            />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-600">취소</button>
          <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 bg-pink-500 text-white rounded-lg text-sm font-medium hover:bg-pink-600 disabled:opacity-50">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
