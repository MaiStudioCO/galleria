import { useState } from 'react'
import { addSource, pickFolder } from '../api'
import { useScanEvents } from '../hooks/useScanEvents'

export function FirstRun({ onConfigured }: { onConfigured: () => void }) {
  const [dir, setDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const { progress } = useScanEvents(onConfigured)

  const submit = async () => {
    setError(null)
    const res = await addSource(dir.trim())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'That folder could not be opened')
      return
    }
    setScanning(true)
  }

  const browse = async () => {
    const { path } = await pickFolder()
    if (path) setDir(path)
  }

  return (
    <div className="first-run">
      <h1>galleria</h1>
      {!scanning ? (
        <>
          <p>Point me at your photo folder to build the map. You can add more folders later.</p>
          <input
            data-testid="folder-input"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="/Users/you/Pictures"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <button data-testid="folder-submit" onClick={() => void submit()}>
            Scan photos
          </button>
          <button data-testid="folder-browse" onClick={() => void browse()}>
            Browse…
          </button>
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <p>
          Scanning… {progress.done} / {progress.total || '…'}
        </p>
      )}
    </div>
  )
}
