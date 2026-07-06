import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSource, adoptLegacyPhotoDir, deleteByPaths, getDateBounds, getIndexState, getPhoto,
  getPoints, getUnlocated, listSources, openDb, removeSource, setSourceEnabled, sourceExists,
  upsertPhoto,
} from '../src/db.js'
import type { PhotoRecord } from '../src/exif.js'

const rec = (over: Partial<PhotoRecord>): PhotoRecord => ({
  path: '/p/a.jpg', lat: 41, lon: 29, takenAt: 1000, width: 10, height: 10, mtime: 1, size: 1,
  ...over,
})

let db: ReturnType<typeof openDb>
let src: ReturnType<typeof addSource>

beforeEach(() => {
  db = openDb(':memory:')
  src = addSource(db, '/p')
})

describe('upsertPhoto', () => {
  it('inserts then updates on same path', () => {
    upsertPhoto(db, rec({}), src.id)
    upsertPhoto(db, rec({ lat: 48.8, takenAt: 2000 }), src.id)
    const points = getPoints(db)
    expect(points).toHaveLength(1)
    expect(points[0].lat).toBeCloseTo(48.8)
    expect(points[0].takenAt).toBe(2000)
  })
})

describe('getPoints', () => {
  it('excludes unlocated photos', () => {
    upsertPhoto(db, rec({ path: '/p/geo.jpg' }), src.id)
    upsertPhoto(db, rec({ path: '/p/nogeo.jpg', lat: null, lon: null }), src.id)
    expect(getPoints(db)).toHaveLength(1)
  })
  it('excludes photos from disabled sources', () => {
    const other = addSource(db, '/q')
    upsertPhoto(db, rec({ path: '/p/a.jpg' }), src.id)
    upsertPhoto(db, rec({ path: '/q/b.jpg' }), other.id)
    setSourceEnabled(db, other.id, false)
    const points = getPoints(db)
    expect(points).toHaveLength(1)
    expect(getPhoto(db, points[0].id)?.path).toBe('/p/a.jpg')
  })
})

describe('getDateBounds', () => {
  it('spans located and unlocated photos, respecting enabled sources', () => {
    const other = addSource(db, '/q')
    upsertPhoto(db, rec({ path: '/p/u.jpg', takenAt: 500, lat: null, lon: null }), src.id)
    upsertPhoto(db, rec({ path: '/p/b.jpg', takenAt: 1000 }), src.id)
    upsertPhoto(db, rec({ path: '/q/c.jpg', takenAt: 9000 }), other.id)
    expect(getDateBounds(db)).toEqual([500, 9000])
    setSourceEnabled(db, other.id, false)
    expect(getDateBounds(db)).toEqual([500, 1000])
  })
  it('returns null when empty', () => {
    expect(getDateBounds(db)).toBeNull()
  })
})

describe('getUnlocated', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++)
      upsertPhoto(db, rec({ path: `/p/u${i}.jpg`, lat: null, lon: null, takenAt: i * 100 }), src.id)
    upsertPhoto(db, rec({ path: '/p/geo.jpg', takenAt: 200 }), src.id)
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
  it('excludes disabled sources', () => {
    const other = addSource(db, '/q')
    upsertPhoto(db, rec({ path: '/q/u.jpg', lat: null, lon: null, takenAt: 50 }), other.id)
    expect(getUnlocated(db, {}).total).toBe(6)
    setSourceEnabled(db, other.id, false)
    expect(getUnlocated(db, {}).total).toBe(5)
  })
})

describe('sources', () => {
  it('lists sources with photo counts', () => {
    upsertPhoto(db, rec({ path: '/p/a.jpg' }), src.id)
    upsertPhoto(db, rec({ path: '/p/b.jpg' }), src.id)
    const other = addSource(db, '/q')
    expect(listSources(db)).toEqual([
      { id: src.id, path: '/p', enabled: true, photoCount: 2 },
      { id: other.id, path: '/q', enabled: true, photoCount: 0 },
    ])
  })
  it('removeSource cascades photo rows and reports unknown ids', () => {
    upsertPhoto(db, rec({ path: '/p/a.jpg' }), src.id)
    expect(removeSource(db, src.id)).toBe(true)
    expect(listSources(db)).toHaveLength(0)
    expect(getPoints(db)).toHaveLength(0)
    expect(sourceExists(db, src.id)).toBe(false)
    expect(removeSource(db, 999)).toBe(false)
  })
  it('setSourceEnabled toggles and reports unknown ids', () => {
    expect(setSourceEnabled(db, src.id, false)).toBe(true)
    expect(listSources(db)[0].enabled).toBe(false)
    expect(setSourceEnabled(db, 999, true)).toBe(false)
  })
})

describe('legacy migration', () => {
  it('adds source_id to an old-schema database; adoptLegacyPhotoDir backfills', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'yufu-db-mig-')), 'index.db')
    const legacy = new Database(file)
    legacy.exec(`
      CREATE TABLE photos (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, lat REAL, lon REAL,
        taken_at INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        mtime INTEGER NOT NULL, size INTEGER NOT NULL
      );
      INSERT INTO photos (path, lat, lon, taken_at, width, height, mtime, size)
      VALUES ('/legacy/a.jpg', 41, 29, 1000, 10, 10, 1, 1);
    `)
    legacy.close()

    const migrated = openDb(file)
    // Pre-adoption rows have source_id 0, which no query ever matches.
    expect(getPoints(migrated)).toHaveLength(0)
    adoptLegacyPhotoDir(migrated, '/legacy')
    const sources = listSources(migrated)
    expect(sources).toEqual([{ id: sources[0].id, path: '/legacy', enabled: true, photoCount: 1 }])
    expect(getPoints(migrated)).toHaveLength(1)
  })
  it('openDb is idempotent on an already-migrated database', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'yufu-db-mig2-')), 'index.db')
    openDb(file).close()
    expect(listSources(openDb(file))).toHaveLength(0)
  })
})

describe('getPhoto / getIndexState / deleteByPaths', () => {
  it('round-trips a photo by id', () => {
    upsertPhoto(db, rec({}), src.id)
    const id = getPoints(db)[0].id
    expect(getPhoto(db, id)?.path).toBe('/p/a.jpg')
    expect(getPhoto(db, 9999)).toBeUndefined()
  })
  it('scopes scan state to one source and deletes by path', () => {
    const other = addSource(db, '/q')
    upsertPhoto(db, rec({ path: '/p/a.jpg', mtime: 5, size: 7 }), src.id)
    upsertPhoto(db, rec({ path: '/q/b.jpg' }), other.id)
    const state = getIndexState(db, src.id)
    expect(state.size).toBe(1)
    expect(state.get('/p/a.jpg')).toEqual({ mtime: 5, size: 7 })
    deleteByPaths(db, ['/p/a.jpg'])
    expect(getIndexState(db, src.id).size).toBe(0)
    expect(getIndexState(db, other.id).size).toBe(1)
  })
})
