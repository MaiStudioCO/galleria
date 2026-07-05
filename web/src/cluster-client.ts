import type { PhotoPoint } from './api'

export interface ClusterFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: {
    cluster?: boolean
    cluster_id?: number
    point_count?: number
    point_count_abbreviated?: string | number
    id?: number
    takenAt?: number
    photoId: number
    newest?: number
  }
}

export function createClusterClient() {
  const worker = new Worker(new URL('./cluster.worker.ts', import.meta.url), { type: 'module' })
  let nextReq = 1
  const pending = new Map<number, { resolve: (msg: any) => void; reject: (err: unknown) => void }>()
  const rebuildListeners = new Set<() => void>()

  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'ready') {
      rebuildListeners.forEach((fn) => fn())
    } else if (msg.reqId !== undefined) {
      pending.get(msg.reqId)?.resolve(msg)
      pending.delete(msg.reqId)
    }
  }

  const request = <T>(payload: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
      const reqId = nextReq++
      pending.set(reqId, { resolve: resolve as (msg: unknown) => void, reject })
      worker.postMessage({ ...payload, reqId })
    })

  return {
    init: (points: PhotoPoint[]) => worker.postMessage({ type: 'init', points }),
    filter: (from: number, to: number) => worker.postMessage({ type: 'filter', from, to }),
    onRebuild: (fn: () => void) => {
      rebuildListeners.add(fn)
      return () => rebuildListeners.delete(fn)
    },
    getClusters: (bbox: [number, number, number, number], zoom: number) =>
      request<{ features: ClusterFeature[] }>({ type: 'query', bbox, zoom }).then((m) => m.features),
    getLeaves: (clusterId: number) =>
      request<{ leaves: ClusterFeature[] }>({ type: 'leaves', clusterId }).then((m) => m.leaves),
    getExpansionZoom: (clusterId: number) =>
      request<{ zoom: number }>({ type: 'expansionZoom', clusterId }).then((m) => m.zoom),
    destroy: () => {
      pending.forEach(({ reject }) => reject(new Error('cluster client destroyed')))
      pending.clear()
      rebuildListeners.clear()
      worker.terminate()
    },
  }
}
