import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import type { PhotoPoint } from '../api'
import { createClusterClient, type ClusterFeature } from '../cluster-client'

const LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const MAX_CLUSTER_ZOOM = 16

export interface MapViewProps {
  points: PhotoPoint[]
  range: [number, number] | null
  onOpenGrid: (photos: { id: number; takenAt: number }[]) => void
  onOpenPhoto: (id: number) => void
}

type ClusterClient = ReturnType<typeof createClusterClient>

export function MapView({ points, range, onOpenGrid, onOpenPhoto }: MapViewProps) {
  const el = useRef<HTMLDivElement>(null)
  const clientRef = useRef<ClusterClient | null>(null)
  const callbacks = useRef({ onOpenGrid, onOpenPhoto })
  callbacks.current = { onOpenGrid, onOpenPhoto }

  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const map = new maplibregl.Map({
      container: el.current!,
      style: dark ? DARK : LIGHT,
      center: [15, 30],
      zoom: 1.5,
      maxZoom: 18,
    })
    const client = createClusterClient()
    clientRef.current = client
    const markers = new Map<string, maplibregl.Marker>()

    const handleClick = async (f: ClusterFeature) => {
      if (!f.properties.cluster) {
        callbacks.current.onOpenPhoto(f.properties.id!)
        return
      }
      const zoom = await client.getExpansionZoom(f.properties.cluster_id!)
      if (zoom > MAX_CLUSTER_ZOOM) {
        const leaves = await client.getLeaves(f.properties.cluster_id!)
        callbacks.current.onOpenGrid(
          leaves.map((l) => ({ id: l.properties.id!, takenAt: l.properties.takenAt! })),
        )
      } else {
        map.easeTo({ center: f.geometry.coordinates, zoom })
      }
    }

    const markerElement = (f: ClusterFeature) => {
      const div = document.createElement('div')
      div.className = 'photo-marker'
      const img = document.createElement('img')
      img.src = `/thumb/${f.properties.photoId}?size=96`
      img.loading = 'lazy'
      div.appendChild(img)
      if (f.properties.cluster) {
        const badge = document.createElement('span')
        badge.className = 'marker-badge'
        badge.textContent = String(f.properties.point_count_abbreviated ?? f.properties.point_count)
        div.appendChild(badge)
      }
      div.addEventListener('click', (e) => {
        e.stopPropagation()
        void handleClick(f)
      })
      return div
    }

    const clearMarkers = () => {
      markers.forEach((m) => m.remove())
      markers.clear()
    }

    const refresh = async () => {
      const b = map.getBounds()
      const features = await client.getClusters(
        [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        Math.floor(map.getZoom()),
      )
      const keep = new Set<string>()
      for (const f of features) {
        const key = f.properties.cluster ? `c${f.properties.cluster_id}` : `p${f.properties.id}`
        keep.add(key)
        if (markers.has(key)) continue
        const marker = new maplibregl.Marker({ element: markerElement(f) })
          .setLngLat(f.geometry.coordinates)
          .addTo(map)
        markers.set(key, marker)
      }
      for (const [key, marker] of markers) {
        if (!keep.has(key)) {
          marker.remove()
          markers.delete(key)
        }
      }
    }

    // A rebuild invalidates cluster ids — clear everything, then redraw.
    const offRebuild = client.onRebuild(() => {
      clearMarkers()
      void refresh().catch(() => {})
    })
    map.on('moveend', () => void refresh().catch(() => {}))

    return () => {
      offRebuild()
      client.destroy()
      clientRef.current = null
      clearMarkers()
      map.remove()
    }
  }, [])

  useEffect(() => {
    if (points.length > 0) clientRef.current?.init(points)
  }, [points])

  useEffect(() => {
    if (range) clientRef.current?.filter(range[0], range[1])
  }, [range])

  return <div ref={el} className="map" />
}
