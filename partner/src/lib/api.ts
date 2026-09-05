export interface PartnerEvent {
  id: string
  title: string
  description: string | null
  thumbnail_urls: string[]
  event_date: string
  location_region: string
  price_male: number | null
  price_female: number | null
  capacity_male: number | null
  capacity_female: number | null
  hashtags: string[]
  is_active: boolean
  created_at: string
}

export type EventInput = Omit<PartnerEvent, 'id' | 'is_active' | 'created_at'>

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `request_failed_${res.status}`)
  return data
}

export const eventsApi = {
  list: () => call<{ events: PartnerEvent[] }>('/api/events').then((r) => r.events),
  create: (input: EventInput) =>
    call<{ event: PartnerEvent }>('/api/events', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.event,
    ),
  update: (id: string, patch: Partial<EventInput>) =>
    call<{ event: PartnerEvent }>(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.event,
    ),
  remove: (id: string) => call<{ ok: true }>(`/api/events/${id}`, { method: 'DELETE' }),
}

export const discountApi = {
  get: () => call<{ benefit: string }>('/api/discount').then((r) => r.benefit),
  set: (benefit: string) =>
    call<{ ok: true; benefit: string }>('/api/discount', { method: 'PUT', body: JSON.stringify({ benefit }) }),
}

export const accountApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ ok: true }>('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
}
