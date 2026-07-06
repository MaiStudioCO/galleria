import Supercluster from 'supercluster'
import type { PhotoPoint } from './api'
import { filterByRange } from './lib/points'

interface LeafProps {
  id: number
  takenAt: number
  photoId: number
  newest: number
}

let all: PhotoPoint[] = []
let index: Supercluster<LeafProps, { photoId: number; newest: number }> | null = null

function build(points: PhotoPoint[]) {
  index = new Supercluster<LeafProps, { photoId: number; newest: number }>({
    radius: 70,
    maxZoom: 16,
    map: (props) => ({ photoId: props.photoId, newest: props.newest }),
    reduce: (acc, props) => {
      if (props.newest > acc.newest) {
        acc.newest = props.newest
        acc.photoId = props.photoId
      }
    },
  })
  index.load(
    points.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { id: p.id, takenAt: p.takenAt, photoId: p.id, newest: p.takenAt },
    })),
  )
  postMessage({ type: 'ready', count: points.length })
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'init') {
    all = msg.points as PhotoPoint[]
    build(all)
  } else if (msg.type === 'filter') {
    build(filterByRange(all, msg.from, msg.to))
  } else if (msg.type === 'query') {
    postMessage({ type: 'clusters', reqId: msg.reqId, features: index ? index.getClusters(msg.bbox, msg.zoom) : [] })
  } else if (msg.type === 'leaves') {
    postMessage({ type: 'leaves', reqId: msg.reqId, leaves: index ? index.getLeaves(msg.clusterId, Infinity) : [] })
  } else if (msg.type === 'expansionZoom') {
    postMessage({ type: 'expansionZoom', reqId: msg.reqId, zoom: index ? index.getClusterExpansionZoom(msg.clusterId) : 0 })
  }
}
