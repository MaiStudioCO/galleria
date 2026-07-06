import { useCallback, useEffect, useState } from 'react'
import { fetchLibrary, fetchPoints, fetchSources, type PhotoPoint, type Source } from './api'
import { FirstRun } from './components/FirstRun'
import { GridPanel } from './components/GridPanel'
import { Lightbox } from './components/Lightbox'
import { MapView } from './components/MapView'
import { SettingsSheet } from './components/SettingsSheet'
import { TimelineBar } from './components/TimelineBar'
import { UnlocatedTray } from './components/UnlocatedTray'
import { histogram } from './lib/points'

export default function App() {
  const [sources, setSources] = useState<Source[] | undefined>(undefined)
  const [points, setPoints] = useState<PhotoPoint[]>([])
  const [span, setSpan] = useState<[number, number] | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [gridPhotos, setGridPhotos] = useState<{ id: number }[] | null>(null)
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null)

  const loadLibrary = useCallback(async () => {
    const [pts, library] = await Promise.all([fetchPoints(), fetchLibrary()])
    setPoints(pts)
    // Bounds cover the whole enabled library (unlocated included), so an
    // all-unlocated folder still gets a timeline and tray.
    setSpan(library.bounds)
    setRange(library.bounds)
  }, [])

  const reloadSources = useCallback(() => {
    setLoadError(false)
    void fetchSources()
      .then((list) => {
        setSources(list)
        if (list.length > 0) void loadLibrary()
      })
      .catch(() => setLoadError(true))
  }, [loadLibrary])

  useEffect(() => {
    reloadSources()
  }, [reloadSources])

  if (loadError) {
    return (
      <div className="first-run">
        <h1>yufu</h1>
        <p>Can't reach the local server. Is it still running?</p>
        <button onClick={reloadSources}>Retry</button>
      </div>
    )
  }

  if (sources === undefined) return null

  if (sources.length === 0) {
    return <FirstRun onConfigured={reloadSources} />
  }

  const missing = sources.filter((s) => s.enabled && !s.exists)
  const bins = span ? histogram(points, span[0], span[1], 120) : []

  return (
    <>
      {missing.length > 0 && (
        <div className="banner">
          Photo folder “{missing[0].path}”
          {missing.length > 1 ? ` and ${missing.length - 1} more are` : ' is'} not reachable — showing
          the cached index.
          <button onClick={() => setSettingsOpen(true)}>Manage folders</button>
        </div>
      )}
      <MapView
        points={points}
        range={range}
        focus={focus}
        onOpenGrid={(photos) => setGridPhotos(photos)}
        onOpenPhoto={(id) => setLightbox({ ids: [id], index: 0 })}
      />
      {span && range && <TimelineBar span={span} range={range} bins={bins} onChange={setRange} />}
      {range && <UnlocatedTray range={range} onOpenPhoto={(ids, index) => setLightbox({ ids, index })} />}
      {gridPhotos && (
        <GridPanel
          photos={gridPhotos}
          onClose={() => setGridPhotos(null)}
          onPhoto={(i) => setLightbox({ ids: gridPhotos.map((p) => p.id), index: i })}
        />
      )}
      {lightbox && (
        <Lightbox
          ids={lightbox.ids}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox({ ...lightbox, index: i })}
          onShowOnMap={(lat, lon) => {
            setFocus((f) => ({ lat, lon, seq: (f?.seq ?? 0) + 1 }))
            setLightbox(null)
            setGridPhotos(null)
          }}
        />
      )}
      <button className="settings-button" title="Settings" onClick={() => setSettingsOpen(true)}>
        ⚙︎
      </button>
      {settingsOpen && (
        <SettingsSheet
          sources={sources}
          onClose={() => setSettingsOpen(false)}
          onChanged={reloadSources}
        />
      )}
    </>
  )
}
