import { useEffect, useState } from 'react'
import { fetchPhoto, type PhotoDetail } from '../api'

export interface LightboxProps {
  ids: number[]
  index: number
  onClose: () => void
  onIndex: (index: number) => void
}

export function Lightbox({ ids, index, onClose, onIndex }: LightboxProps) {
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const id = ids[index]

  useEffect(() => {
    let ignore = false
    setDetail(null)
    void fetchPhoto(id)
      .then((d) => { if (!ignore) setDetail(d) })
      .catch(() => {})
    return () => { ignore = true }
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < ids.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, ids.length, onClose, onIndex])

  return (
    <div className="lightbox" data-testid="lightbox" onClick={onClose}>
      <img src={`/thumb/${id}?size=2048`} onClick={(e) => e.stopPropagation()} />
      {detail && (
        <footer onClick={(e) => e.stopPropagation()}>
          <span>{detail.path.split('/').pop()}</span>
          <span>{new Date(detail.taken_at).toLocaleString()}</span>
          <span>
            {detail.width}×{detail.height}
          </span>
        </footer>
      )}
      {index > 0 && (
        <button className="nav prev" onClick={(e) => { e.stopPropagation(); onIndex(index - 1) }}>
          ‹
        </button>
      )}
      {index < ids.length - 1 && (
        <button className="nav next" onClick={(e) => { e.stopPropagation(); onIndex(index + 1) }}>
          ›
        </button>
      )}
    </div>
  )
}
