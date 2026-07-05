import Database from 'better-sqlite3'
import type { PhotoRecord } from './exif.js'

export type Db = Database.Database

const MAX_TS = 8.64e15

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
  `)
  return db
}

export function upsertPhoto(db: Db, p: PhotoRecord): void {
  db.prepare(
    `INSERT INTO photos (path, lat, lon, taken_at, width, height, mtime, size)
     VALUES (@path, @lat, @lon, @takenAt, @width, @height, @mtime, @size)
     ON CONFLICT(path) DO UPDATE SET
       lat=@lat, lon=@lon, taken_at=@takenAt, width=@width, height=@height, mtime=@mtime, size=@size`,
  ).run(p as unknown as Record<string, unknown>)
}

export interface PhotoPointRow { id: number; lat: number; lon: number; takenAt: number }

export function getPoints(db: Db): PhotoPointRow[] {
  return db
    .prepare(`SELECT id, lat, lon, taken_at AS takenAt FROM photos WHERE lat IS NOT NULL`)
    .all() as PhotoPointRow[]
}

export interface UnlocatedQuery { from?: number; to?: number; page?: number; pageSize?: number }
export interface UnlocatedRow { id: number; path: string; takenAt: number; width: number; height: number }

export function getUnlocated(db: Db, q: UnlocatedQuery): { total: number; photos: UnlocatedRow[] } {
  const from = q.from ?? 0
  const to = q.to ?? MAX_TS
  const page = q.page ?? 0
  const pageSize = q.pageSize ?? 100
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE lat IS NULL AND taken_at BETWEEN ? AND ?`).get(from, to) as { c: number }
  ).c
  const photos = db
    .prepare(
      `SELECT id, path, taken_at AS takenAt, width, height
       FROM photos WHERE lat IS NULL AND taken_at BETWEEN ? AND ?
       ORDER BY taken_at DESC LIMIT ? OFFSET ?`,
    )
    .all(from, to, pageSize, page * pageSize) as UnlocatedRow[]
  return { total, photos }
}

export interface PhotoRow {
  id: number; path: string; lat: number | null; lon: number | null
  taken_at: number; width: number; height: number; mtime: number; size: number
}

export function getPhoto(db: Db, id: number): PhotoRow | undefined {
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id) as PhotoRow | undefined
}

export function getIndexState(db: Db): Map<string, { mtime: number; size: number }> {
  const rows = db.prepare(`SELECT path, mtime, size FROM photos`).all() as {
    path: string; mtime: number; size: number
  }[]
  return new Map(rows.map((r) => [r.path, { mtime: r.mtime, size: r.size }]))
}

export function deleteByPaths(db: Db, paths: string[]): void {
  const del = db.prepare(`DELETE FROM photos WHERE path = ?`)
  const tx = db.transaction((ps: string[]) => { for (const p of ps) del.run(p) })
  tx(paths)
}
