import { useRef } from 'react'

export interface DualSliderProps {
  min: number
  max: number
  value: [number, number]
  onChange: (value: [number, number]) => void
}

export function DualSlider({ min, max, value, onChange }: DualSliderProps) {
  const track = useRef<HTMLDivElement>(null)
  const latest = useRef(value)
  latest.current = value

  const pct = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100)

  function startDrag(which: 0 | 1, down: React.PointerEvent) {
    down.preventDefault()
    const rect = track.current!.getBoundingClientRect()
    const onMove = (e: PointerEvent) => {
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const v = Math.round(min + ratio * (max - min))
      const [lo, hi] = latest.current
      onChange(which === 0 ? [Math.min(v, hi), hi] : [lo, Math.max(v, lo)])
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className="dual-slider" ref={track}>
      <div
        className="range-fill"
        style={{ left: `${pct(value[0])}%`, width: `${pct(value[1]) - pct(value[0])}%` }}
      />
      <div className="handle" style={{ left: `${pct(value[0])}%` }} onPointerDown={(e) => startDrag(0, e)} />
      <div className="handle" style={{ left: `${pct(value[1])}%` }} onPointerDown={(e) => startDrag(1, e)} />
    </div>
  )
}
