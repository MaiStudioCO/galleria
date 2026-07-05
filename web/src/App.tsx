import { useCallback, useEffect, useState } from 'react'
import { fetchConfig, fetchPoints, type Config, type PhotoPoint } from './api'
import { GridPanel } from './components/GridPanel'
import { MapView } from './components/MapView'
import { dateSpan } from './lib/points'

export default function App() {
  const [config, setConfig] = useState<Config | undefined>(undefined)
  const [points, setPoints] = useState<PhotoPoint[]>([])
  const [span, setSpan] = useState<[number, number] | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [gridPhotos, setGridPhotos] = useState<{ id: number }[] | null>(null)
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null)

  const loadLibrary = useCallback(async () => {
    const pts = await fetchPoints()
    setPoints(pts)
    const s = dateSpan(pts)
    setSpan(s)
    setRange(s)
  }, [])

  useEffect(() => {
    void fetchConfig().then((c) => {
      setConfig(c)
      if (c.photoDir) void loadLibrary()
    })
  }, [loadLibrary])

  if (config === undefined) return null

  return (
    <>
      <MapView
        points={points}
        range={range}
        onOpenGrid={(photos) => setGridPhotos(photos)}
        onOpenPhoto={(id) => setLightbox({ ids: [id], index: 0 })}
      />
      {gridPhotos && (
        <GridPanel
          photos={gridPhotos}
          onClose={() => setGridPhotos(null)}
          onPhoto={(i) => setLightbox({ ids: gridPhotos.map((p) => p.id), index: i })}
        />
      )}
      {/* Lightbox mounts in Task 14; log for now so clicks are observable */}
      {lightbox && <div style={{ display: 'none' }} data-testid="lightbox-placeholder" />}
    </>
  )
}
