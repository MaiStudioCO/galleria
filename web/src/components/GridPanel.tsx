export interface GridPanelProps {
  photos: { id: number }[]
  onClose: () => void
  onPhoto: (index: number) => void
}

export function GridPanel({ photos, onClose, onPhoto }: GridPanelProps) {
  return (
    <div className="grid-panel panel" data-testid="grid-panel">
      <header>
        <span>{photos.length} photos</span>
        <button onClick={onClose}>✕</button>
      </header>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <img key={p.id} src={`/thumb/${p.id}?size=256`} loading="lazy" onClick={() => onPhoto(i)} />
        ))}
      </div>
    </div>
  )
}
