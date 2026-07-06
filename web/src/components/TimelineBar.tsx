import { DualSlider } from './DualSlider'

const DAY_MS = 86_400_000

export interface TimelineBarProps {
  span: [number, number]
  range: [number, number]
  bins: number[]
  onChange: (range: [number, number]) => void
}

export function TimelineBar({ span, range, bins, onChange }: TimelineBarProps) {
  const [lo, hi] = range
  const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const maxBin = Math.max(1, ...bins)

  return (
    <div className="timeline-bar panel">
      <input
        id="date-from"
        type="date"
        value={toInput(lo)}
        onChange={(e) => {
          const t = e.target.valueAsNumber
          if (!Number.isNaN(t)) onChange([Math.min(t, hi), hi])
        }}
      />
      <div className="slider-area">
        <svg className="histogram" viewBox={`0 0 ${bins.length} 40`} preserveAspectRatio="none">
          {bins.map((b, i) => (
            <rect key={i} x={i + 0.1} y={40 - (b / maxBin) * 40} width={0.8} height={(b / maxBin) * 40} />
          ))}
        </svg>
        <DualSlider min={span[0]} max={span[1]} value={range} onChange={onChange} />
      </div>
      <input
        id="date-to"
        type="date"
        value={toInput(hi)}
        onChange={(e) => {
          const t = e.target.valueAsNumber
          if (!Number.isNaN(t)) onChange([lo, Math.max(t + DAY_MS - 1, lo)])
        }}
      />
    </div>
  )
}
