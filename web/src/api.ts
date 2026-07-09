export interface Source {
  id: number
  path: string
  enabled: boolean
  exists: boolean
  photoCount: number
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
export interface Library {
  /** Min/max takenAt across enabled sources (located or not); null when empty. */
  bounds: [number, number] | null
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

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const fetchSources = () => get<Source[]>('/api/sources')
export const fetchPoints = () => get<PhotoPoint[]>('/api/photos')
export const fetchLibrary = () => get<Library>('/api/library')
export const fetchPhoto = (id: number) => get<PhotoDetail>(`/api/photos/${id}`)
export const fetchUnlocated = (q: { from?: number; to?: number; page?: number }) => {
  const params = new URLSearchParams()
  if (q.from !== undefined) params.set('from', String(q.from))
  if (q.to !== undefined) params.set('to', String(q.to))
  if (q.page !== undefined) params.set('page', String(q.page))
  return get<UnlocatedResult>(`/api/photos/unlocated?${params}`)
}
export const addSource = (path: string) => fetch('/api/sources', json('POST', { path }))
export const patchSource = (id: number, enabled: boolean) =>
  fetch(`/api/sources/${id}`, json('PATCH', { enabled }))
export const deleteSource = (id: number) => fetch(`/api/sources/${id}`, { method: 'DELETE' })
export const startScan = () => fetch('/api/scan', { method: 'POST' })
export const pickFolder = () =>
  fetch('/api/pick-folder', { method: 'POST' }).then(
    (r) => (r.ok ? (r.json() as Promise<{ path: string | null }>) : { path: null }),
  )
export const shutdown = () => fetch('/api/shutdown', { method: 'POST' })
