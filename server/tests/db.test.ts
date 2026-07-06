import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteByPaths, getDateBounds, getIndexState, getPhoto, getPoints, getUnlocated, openDb, upsertPhoto,
} from '../src/db.js'
import type { PhotoRecord } from '../src/exif.js'

const rec = (over: Partial<PhotoRecord>): PhotoRecord => ({
  path: '/p/a.jpg', lat: 41, lon: 29, takenAt: 1000, width: 10, height: 10, mtime: 1, size: 1,
  ...over,
})

let db: ReturnType<typeof openDb>
beforeEach(() => { db = openDb(':memory:') })

describe('upsertPhoto', () => {
  it('inserts then updates on same path', () => {
    upsertPhoto(db, rec({}))
    upsertPhoto(db, rec({ lat: 48.8, takenAt: 2000 }))
    const points = getPoints(db)
    expect(points).toHaveLength(1)
    expect(points[0].lat).toBeCloseTo(48.8)
    expect(points[0].takenAt).toBe(2000)
  })
})

describe('getPoints', () => {
  it('excludes unlocated photos', () => {
    upsertPhoto(db, rec({ path: '/p/geo.jpg' }))
    upsertPhoto(db, rec({ path: '/p/nogeo.jpg', lat: null, lon: null }))
    expect(getPoints(db)).toHaveLength(1)
  })
})

describe('getUnlocated', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++)
      upsertPhoto(db, rec({ path: `/p/u${i}.jpg`, lat: null, lon: null, takenAt: i * 100 }))
    upsertPhoto(db, rec({ path: '/p/geo.jpg', takenAt: 200 }))
  })
  it('counts and filters by date range', () => {
    const r = getUnlocated(db, { from: 100, to: 300 })
    expect(r.total).toBe(3)
    expect(r.photos.map((p) => p.takenAt)).toEqual([300, 200, 100])
  })
  it('paginates', () => {
    const r = getUnlocated(db, { page: 1, pageSize: 2 })
    expect(r.total).toBe(5)
    expect(r.photos).toHaveLength(2)
    expect(r.photos[0].takenAt).toBe(200)
  })
})

describe('getPhoto / getIndexState / deleteByPaths', () => {
  it('round-trips a photo by id', () => {
    upsertPhoto(db, rec({}))
    const id = getPoints(db)[0].id
    expect(getPhoto(db, id)?.path).toBe('/p/a.jpg')
    expect(getPhoto(db, 9999)).toBeUndefined()
  })
  it('returns scan state and deletes by path', () => {
    upsertPhoto(db, rec({ path: '/p/a.jpg', mtime: 5, size: 7 }))
    upsertPhoto(db, rec({ path: '/p/b.jpg' }))
    const state = getIndexState(db)
    expect(state.get('/p/a.jpg')).toEqual({ mtime: 5, size: 7 })
    deleteByPaths(db, ['/p/a.jpg'])
    expect(getIndexState(db).has('/p/a.jpg')).toBe(false)
    expect(getIndexState(db).size).toBe(1)
  })
})

describe('getDateBounds', () => {
  it('returns null when the table is empty', () => {
    expect(getDateBounds(db)).toBeNull()
  })
  it('spans all photos including unlocated ones', () => {
    upsertPhoto(db, rec({ path: '/p/geo.jpg', takenAt: 2000 }))
    upsertPhoto(db, rec({ path: '/p/early.jpg', lat: null, lon: null, takenAt: 500 }))
    upsertPhoto(db, rec({ path: '/p/late.jpg', lat: null, lon: null, takenAt: 9000 }))
    expect(getDateBounds(db)).toEqual([500, 9000])
  })
})
