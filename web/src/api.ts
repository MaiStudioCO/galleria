export interface Config {
  photoDir: string | null
}
export interface PhotoPoint {
  id: number
  lat: number
  lon: number
  takenAt: number
}
export interface PhotoDetail {
  id: number
  path: string
  lat: number | null
  lon: number | null
  taken_at: number
  width: number
  height: number
}
export interface UnlocatedResult {
  total: number
  photos: { id: number; path: string; takenAt: number; width: number; height: number }[]
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json() as Promise<T>
}

export const fetchConfig = () => get<Config>('/api/config')
export const fetchPoints = () => get<PhotoPoint[]>('/api/photos')
export const fetchPhoto = (id: number) => get<PhotoDetail>(`/api/photos/${id}`)
export const fetchUnlocated = (q: { from?: number; to?: number; page?: number }) => {
  const params = new URLSearchParams()
  if (q.from !== undefined) params.set('from', String(q.from))
  if (q.to !== undefined) params.set('to', String(q.to))
  if (q.page !== undefined) params.set('page', String(q.page))
  return get<UnlocatedResult>(`/api/photos/unlocated?${params}`)
}
export const putConfig = (photoDir: string) =>
  fetch('/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ photoDir }),
  })
export const startScan = () => fetch('/api/scan', { method: 'POST' })
