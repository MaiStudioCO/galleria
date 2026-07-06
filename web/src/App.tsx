import { useCallback, useEffect, useState } from 'react'
import { fetchConfig, fetchPoints, type Config, type PhotoPoint } from './api'
import { FirstRun } from './components/FirstRun'
import { GridPanel } from './components/GridPanel'
import { Lightbox } from './components/Lightbox'
import { MapView } from './components/MapView'
import { SettingsSheet } from './components/SettingsSheet'
import { TimelineBar } from './components/TimelineBar'
import { UnlocatedTray } from './components/UnlocatedTray'
import { dateSpan, histogram } from './lib/points'

export default function App() {
  const [config, setConfig] = useState<Config | undefined>(undefined)
  const [points, setPoints] = useState<PhotoPoint[]>([])
  const [span, setSpan] = useState<[number, number] | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [gridPhotos, setGridPhotos] = useState<{ id: number }[] | null>(null)
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configError, setConfigError] = useState(false)

  const loadLibrary = useCallback(async () => {
    const pts = await fetchPoints()
    setPoints(pts)
    const s = dateSpan(pts)
    setSpan(s)
    setRange(s)
  }, [])

  useEffect(() => {
    setConfigError(false)
    void fetchConfig()
      .then((c) => {
        setConfig(c)
        if (c.photoDir) void loadLibrary()
      })
      .catch(() => setConfigError(true))
  }, [loadLibrary])

  if (configError) {
    return (
      <div className="first-run">
        <h1>yufu</h1>
        <p>Can't reach the local server. Is it still running?</p>
        <button
          onClick={() => {
            setConfigError(false)
            void fetchConfig()
              .then((c) => {
                setConfig(c)
                if (c.photoDir) void loadLibrary()
              })
              .catch(() => setConfigError(true))
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (config === undefined) return null

  if (!config.photoDir) {
    return (
      <FirstRun
        onConfigured={() => {
          setConfigError(false)
          void fetchConfig()
            .then((c) => {
              setConfig(c)
              void loadLibrary()
            })
            .catch(() => setConfigError(true))
        }}
      />
    )
  }

  const bins = span ? histogram(points, span[0], span[1], 120) : []

  return (
    <>
      <MapView
        points={points}
        range={range}
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
        />
      )}
      <button className="settings-button" title="Settings" onClick={() => setSettingsOpen(true)}>
        ⚙︎
      </button>
      {settingsOpen && (
        <SettingsSheet config={config} onClose={() => setSettingsOpen(false)} onRescanned={loadLibrary} />
      )}
    </>
  )
}
