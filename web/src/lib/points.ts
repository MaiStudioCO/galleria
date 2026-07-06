import type { PhotoPoint } from '../api'

export function filterByRange(points: PhotoPoint[], from: number, to: number): PhotoPoint[] {
  return points.filter((p) => p.takenAt >= from && p.takenAt <= to)
}

export function dateSpan(points: { takenAt: number }[]): [number, number] | null {
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.takenAt < min) min = p.takenAt
    if (p.takenAt > max) max = p.takenAt
  }
  return [min, max]
}

export function histogram(
  items: { takenAt: number }[],
  from: number,
  to: number,
  binCount: number,
): number[] {
  const bins = new Array<number>(binCount).fill(0)
  const span = to - from
  if (span <= 0) return bins
  for (const p of items) {
    if (p.takenAt < from || p.takenAt > to) continue
    const i = Math.min(binCount - 1, Math.floor(((p.takenAt - from) / span) * binCount))
    bins[i]++
  }
  return bins
}
