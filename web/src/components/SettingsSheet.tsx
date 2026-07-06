import { useState } from 'react'
import { putConfig, startScan, type Config } from '../api'
import { useScanEvents } from '../hooks/useScanEvents'

export interface SettingsSheetProps {
  config: Config
  onClose: () => void
  onRescanned: () => void
}

export function SettingsSheet({ config, onClose, onRescanned }: SettingsSheetProps) {
  const [dir, setDir] = useState(config.photoDir ?? '')
  const [status, setStatus] = useState<string | null>(null)
  const { running, progress } = useScanEvents(onRescanned)

  const save = async () => {
    const res = await putConfig(dir.trim())
    setStatus(res.ok ? 'Saved — rescanning…' : 'Not a valid folder')
  }
  const rescan = async () => {
    await startScan()
    setStatus('Rescanning…')
  }

  return (
    <div className="sheet panel">
      <header>
        <span>Settings</span>
        <button onClick={onClose}>✕</button>
      </header>
      <label htmlFor="settings-folder">Photo folder</label>
      <input id="settings-folder" value={dir} onChange={(e) => setDir(e.target.value)} />
      <div className="row">
        <button onClick={() => void save()}>Save folder</button>
        <button onClick={() => void rescan()}>Rescan</button>
      </div>
      {running && (
        <p>
          Scanning… {progress.done} / {progress.total || '…'}
        </p>
      )}
      {status && <p>{status}</p>}
    </div>
  )
}
