import { useEffect, useState } from 'react'
import { addSource, deleteSource, patchSource, pickFolder, shutdown, startScan, type Source } from '../api'
import { useScanEvents } from '../hooks/useScanEvents'

export interface SettingsSheetProps {
  sources: Source[]
  onClose: () => void
  onChanged: () => void
  onQuit: () => void
}

export function SettingsSheet({ sources, onClose, onChanged, onQuit }: SettingsSheetProps) {
  const [newPath, setNewPath] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)
  const { running, progress } = useScanEvents(onChanged)
  const [skipped, setSkipped] = useState<number>(0)

  useEffect(() => {
    void fetch('/api/scan/status')
      .then((r) => r.json())
      .then((s) => setSkipped(s.lastResult?.skippedUnreadable ?? 0))
      .catch(() => {})
  }, [running])

  const add = async () => {
    setStatus(null)
    const res = await addSource(newPath.trim())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setStatus(body?.error ?? 'Could not add that folder')
      return
    }
    setNewPath('')
    setStatus('Folder added — scanning…')
    onChanged()
  }

  const [browsing, setBrowsing] = useState(false)
  const browse = async () => {
    setBrowsing(true)
    try {
      const { path } = await pickFolder()
      if (path) setNewPath(path)
    } finally {
      setBrowsing(false)
    }
  }

  const toggle = async (s: Source) => {
    await patchSource(s.id, !s.enabled)
    onChanged()
  }

  const remove = async (id: number) => {
    setConfirmRemove(null)
    await deleteSource(id)
    setStatus('Folder removed')
    onChanged()
  }

  const rescan = async () => {
    await startScan()
    setStatus('Rescanning…')
  }

  const [confirmQuit, setConfirmQuit] = useState(false)
  const quit = async () => {
    await shutdown()
    onQuit()
  }

  return (
    <div className="sheet panel">
      <header>
        <span>Settings</span>
        <button onClick={onClose}>✕</button>
      </header>
      <label>Photo folders</label>
      <ul className="source-list" data-testid="source-list">
        {sources.map((s) => (
          <li key={s.id} className={s.enabled ? 'source-row' : 'source-row source-disabled'}>
            <button
              className="source-eye"
              title={s.enabled ? 'Hide this folder' : 'Show this folder'}
              onClick={() => void toggle(s)}
            >
              {s.enabled ? '●' : '○'}
            </button>
            <span className="source-path" title={s.path}>
              {s.path.split('/').pop() || s.path}
            </span>
            {!s.exists && <span className="source-missing" title="Folder not reachable">!</span>}
            <span className="source-count">{s.photoCount}</span>
            {confirmRemove === s.id ? (
              <button className="source-remove danger" onClick={() => void remove(s.id)}>
                Remove?
              </button>
            ) : (
              <button className="source-remove" title="Remove folder" onClick={() => setConfirmRemove(s.id)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          data-testid="add-source-input"
          value={newPath}
          placeholder="/Users/you/Pictures"
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button data-testid="add-source-submit" onClick={() => void add()}>
          Add
        </button>
        <button data-testid="add-source-browse" disabled={browsing} onClick={() => void browse()}>
          {browsing ? 'Choosing…' : 'Browse…'}
        </button>
      </div>
      <div className="row">
        <button onClick={() => void rescan()}>Rescan all</button>
      </div>
      <div className="row">
        {confirmQuit ? (
          <>
            <button className="danger" data-testid="quit-button" onClick={() => void quit()}>
              Quit — are you sure?
            </button>
            <button data-testid="quit-cancel" onClick={() => setConfirmQuit(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button data-testid="quit-button" onClick={() => setConfirmQuit(true)}>
            Quit galleria
          </button>
        )}
      </div>
      {running && (
        <p>
          Scanning… {progress.done} / {progress.total || '…'}
        </p>
      )}
      {status && <p>{status}</p>}
      {skipped > 0 && <p>{skipped} unreadable file{skipped === 1 ? '' : 's'} skipped in the last scan</p>}
    </div>
  )
}
