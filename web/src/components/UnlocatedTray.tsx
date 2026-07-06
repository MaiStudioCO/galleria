import { useEffect, useRef, useState } from 'react'
import { fetchUnlocated, type UnlocatedResult } from '../api'

export interface UnlocatedTrayProps {
  range: [number, number]
  onOpenPhoto: (ids: number[], index: number) => void
}

export function UnlocatedTray({ range, onOpenPhoto }: UnlocatedTrayProps) {
  const [open, setOpen] = useState(false)
  const [total, setTotal] = useState(0)
  const [photos, setPhotos] = useState<UnlocatedResult['photos']>([])
  const [page, setPage] = useState(0)
  const fetchSeq = useRef(0)

  useEffect(() => {
    const seq = ++fetchSeq.current
    setPage(0)
    void fetchUnlocated({ from: range[0], to: range[1], page: 0 }).then((r) => {
      if (seq !== fetchSeq.current) return
      setTotal(r.total)
      setPhotos(r.photos)
    })
  }, [range])

  const loadMore = () => {
    const seq = fetchSeq.current
    const next = page + 1
    void fetchUnlocated({ from: range[0], to: range[1], page: next }).then((r) => {
      if (seq !== fetchSeq.current) return
      setPhotos((p) => [...p, ...r.photos])
      setPage(next)
    })
  }

  if (total === 0) return null

  return (
    <>
      <button className="tray-button" data-testid="unlocated-button" onClick={() => setOpen(!open)}>
        {total} photo{total === 1 ? '' : 's'} without location
      </button>
      {open && (
        <div className="tray-panel panel" data-testid="tray-panel">
          <header>
            <span>No location · {total}</span>
            <button onClick={() => setOpen(false)}>✕</button>
          </header>
          <div className="photo-grid">
            {photos.map((p, i) => (
              <img
                key={p.id}
                src={`/thumb/${p.id}?size=256`}
                loading="lazy"
                onClick={() => onOpenPhoto(photos.map((x) => x.id), i)}
              />
            ))}
          </div>
          {photos.length < total && <button onClick={loadMore}>Load more</button>}
        </div>
      )}
    </>
  )
}
