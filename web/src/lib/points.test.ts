import { describe, expect, it } from 'vitest'
import { dateSpan, filterByRange, histogram } from './points'

const pt = (id: number, takenAt: number) => ({ id, lat: 0, lon: 0, takenAt })
const points = [pt(1, 100), pt(2, 200), pt(3, 300), pt(4, 400)]

describe('filterByRange', () => {
  it('is inclusive on both ends', () => {
    expect(filterByRange(points, 200, 300).map((p) => p.id)).toEqual([2, 3])
  })
  it('returns all when range covers everything', () => {
    expect(filterByRange(points, 0, 1000)).toHaveLength(4)
  })
})

describe('dateSpan', () => {
  it('returns min and max', () => expect(dateSpan(points)).toEqual([100, 400]))
  it('returns null for empty input', () => expect(dateSpan([])).toBeNull())
})

describe('histogram', () => {
  it('bins counts across the range', () => {
    const bins = histogram(points, 100, 400, 3)
    expect(bins).toHaveLength(3)
    expect(bins.reduce((a, b) => a + b, 0)).toBe(4)
    expect(bins[0]).toBe(1) // 100
    expect(bins[2]).toBe(2) // 300 lands in bin 2; 400 (== to) clamps into the last bin
  })
  it('ignores out-of-range items and handles zero span', () => {
    expect(histogram(points, 500, 600, 4)).toEqual([0, 0, 0, 0])
    expect(histogram(points, 300, 300, 4)).toEqual([0, 0, 0, 0])
  })
})
