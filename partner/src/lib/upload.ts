export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: form, credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) throw new Error(data.error ?? 'upload_failed')
  return data.url as string
}

export async function deleteImage(url: string): Promise<void> {
  await fetch(`/api/upload?url=${encodeURIComponent(url)}`, { method: 'DELETE', credentials: 'include' })
}
