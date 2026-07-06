import Database from 'better-sqlite3'
import type { PhotoRecord } from './exif.js'

export type Db = Database.Database

const MAX_TS = 8.64e15

// Photos visible to the app = photos of enabled sources. source_id 0 (pre-adoption
// legacy rows) never matches a real source, so those rows are invisible until
// adoptLegacyPhotoDir runs at startup.
const ENABLED = `source_id IN (SELECT id FROM sources WHERE enabled = 1)`

export function openDb(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      lat REAL,
      lon REAL,
      taken_at INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_taken ON photos(taken_at);
    CREATE INDEX IF NOT EXISTS idx_photos_geo ON photos(lat, lon);
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `)
  // source_id arrived after v1; add it uniformly (fresh and legacy DBs take the
  // same path so there is exactly one schema shape). App-level integrity only —
  // no SQL FK, SQLite FK enforcement stays off.
  const cols = db.prepare(`PRAGMA table_info(photos)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'source_id')) {
    db.exec(`ALTER TABLE photos ADD COLUMN source_id INTEGER NOT NULL DEFAULT 0`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_source ON photos(source_id)`)
  // A source removed mid-scan can leave an orphan photo upsert behind (see the
  // sweep guard in scanner.ts). Nothing ever selects those rows, so purge them
  // here rather than let a later source inherit them via rowid reuse. Exclude
  // source_id 0: those are pre-adoption legacy rows that adoptLegacyPhotoDir
  // (called by the app after openDb returns) still needs to claim.
  db.exec(`DELETE FROM photos WHERE source_id != 0 AND source_id NOT IN (SELECT id FROM sources)`)
  return db
}

export interface SourceRow { id: number; path: string; enabled: boolean; photoCount: number }

export function listSources(db: Db): SourceRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.path, s.enabled, COUNT(p.id) AS photoCount
       FROM sources s LEFT JOIN photos p ON p.source_id = s.id
       GROUP BY s.id ORDER BY s.id`,
    )
    .all() as { id: number; path: string; enabled: number; photoCount: number }[]
  return rows.map((r) => ({ id: r.id, path: r.path, enabled: r.enabled === 1, photoCount: r.photoCount }))
}

export function addSource(db: Db, path: string): SourceRow {
  const info = db.prepare(`INSERT INTO sources (path, enabled) VALUES (?, 1)`).run(path)
  return { id: Number(info.lastInsertRowid), path, enabled: true, photoCount: 0 }
}

export function removeSource(db: Db, id: number): boolean {
  const tx = db.transaction((sid: number): boolean => {
    if (!db.prepare(`SELECT 1 FROM sources WHERE id = ?`).get(sid)) return false
    db.prepare(`DELETE FROM photos WHERE source_id = ?`).run(sid)
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(sid)
    return true
  })
  return tx(id)
}

export function setSourceEnabled(db: Db, id: number, enabled: boolean): boolean {
  return db.prepare(`UPDATE sources SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id).changes > 0
}

export function sourceExists(db: Db, id: number): boolean {
  return db.prepare(`SELECT 1 FROM sources WHERE id = ?`).get(id) !== undefined
}

/** One-time adoption of the legacy single photoDir: create a source and claim every existing row. */
export function adoptLegacyPhotoDir(db: Db, photoDir: string): void {
  const tx = db.transaction(() => {
    const source = addSource(db, photoDir)
    db.prepare(`UPDATE photos SET source_id = ?`).run(source.id)
  })
  tx()
}

export function upsertPhoto(db: Db, p: PhotoRecord, sourceId: number): void {
  db.prepare(
    `INSERT INTO photos (path, lat, lon, taken_at, width, height, mtime, size, source_id)
     VALUES (@path, @lat, @lon, @takenAt, @width, @height, @mtime, @size, @sourceId)
     ON CONFLICT(path) DO UPDATE SET
       lat=@lat, lon=@lon, taken_at=@takenAt, width=@width, height=@height,
       mtime=@mtime, size=@size, source_id=@sourceId`,
  ).run({ ...p, sourceId } as unknown as Record<string, unknown>)
}

export interface PhotoPointRow { id: number; lat: number; lon: number; takenAt: number }

export function getPoints(db: Db): PhotoPointRow[] {
  return db
    .prepare(`SELECT id, lat, lon, taken_at AS takenAt FROM photos WHERE lat IS NOT NULL AND ${ENABLED}`)
    .all() as PhotoPointRow[]
}

/** Min/max taken_at across all photos of enabled sources; null when none. */
export function getDateBounds(db: Db): [number, number] | null {
  const row = db
    .prepare(`SELECT MIN(taken_at) AS min, MAX(taken_at) AS max FROM photos WHERE ${ENABLED}`)
    .get() as { min: number | null; max: number | null }
  if (row.min === null || row.max === null) return null
  return [row.min, row.max]
}

export interface UnlocatedQuery { from?: number; to?: number; page?: number; pageSize?: number }
export interface UnlocatedRow { id: number; path: string; takenAt: number; width: number; height: number }

export function getUnlocated(db: Db, q: UnlocatedQuery): { total: number; photos: UnlocatedRow[] } {
  const from = q.from ?? 0
  const to = q.to ?? MAX_TS
  const page = q.page ?? 0
  const pageSize = q.pageSize ?? 100
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE lat IS NULL AND taken_at BETWEEN ? AND ? AND ${ENABLED}`)
      .get(from, to) as { c: number }
  ).c
  const photos = db
    .prepare(
      `SELECT id, path, taken_at AS takenAt, width, height
       FROM photos WHERE lat IS NULL AND taken_at BETWEEN ? AND ? AND ${ENABLED}
       ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
    )
    .all(from, to, pageSize, page * pageSize) as UnlocatedRow[]
  return { total, photos }
}

export interface PhotoRow {
  id: number; path: string; lat: number | null; lon: number | null
  taken_at: number; width: number; height: number; mtime: number; size: number
  source_id: number
}

export function getPhoto(db: Db, id: number): PhotoRow | undefined {
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id) as PhotoRow | undefined
}

export function getIndexState(db: Db, sourceId: number): Map<string, { mtime: number; size: number }> {
  const rows = db
    .prepare(`SELECT path, mtime, size FROM photos WHERE source_id = ?`)
    .all(sourceId) as { path: string; mtime: number; size: number }[]
  return new Map(rows.map((r) => [r.path, { mtime: r.mtime, size: r.size }]))
}

export function deleteByPaths(db: Db, paths: string[]): void {
  const del = db.prepare(`DELETE FROM photos WHERE path = ?`)
  const tx = db.transaction((ps: string[]) => { for (const p of ps) del.run(p) })
  tx(paths)
}
