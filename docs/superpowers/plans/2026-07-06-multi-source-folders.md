# Multi-Source Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace yufu's single configured `photoDir` with multiple source folders that can be added, removed, and shown/hidden individually, keeping one merged map/timeline/tray.

**Architecture:** A `sources` table in SQLite plus a `source_id` column on `photos` (idempotent startup migration adopts the legacy `config.photoDir` with a full backfill — no rescan). Sources get CRUD routes; all photo queries filter to enabled sources; the ScanManager scans all enabled sources with one aggregated progress stream; the settings sheet becomes a source manager. Spec: `docs/superpowers/specs/2026-07-06-multi-source-folders-design.md`.

**Tech Stack:** unchanged — Node/Fastify/better-sqlite3/sharp/exifr server, React/Vite/MapLibre web, Vitest + Playwright.

## Global Constraints

- All existing constraints from `docs/superpowers/plans/2026-07-06-photo-map.md` still bind (127.0.0.1 only, ms-epoch timestamps, thumb sizes {96,256,2048}, ESM `.js` import extensions inside `server/`, temp dirs in tests — never the real `~/.yufu`).
- `photos.source_id` is `INTEGER NOT NULL DEFAULT 0` with **no** SQL FOREIGN KEY clause (SQLite FK enforcement stays off; integrity is app-level via transactional `removeSource`). `source_id = 0` only ever exists pre-adoption and is invisible to all queries (0 is never a real source id).
- "Enabled filter" SQL fragment, used verbatim in every photo query: `source_id IN (SELECT id FROM sources WHERE enabled = 1)`.
- Nested-source rule: a new source may not equal, contain, or be contained by an existing source, compared on `path.resolve`d paths at path-separator boundaries (`/a/b` conflicts with `/a/b/c` but NOT with `/a/bc`). Violations → HTTP 409.
- Removing a source deletes its photo rows in the same transaction. Original files are never touched.
- `GET /api/config` and `PUT /api/config` are REMOVED. First-run detection = `GET /api/sources` returns `[]`.
- A scan-request issued while a scan runs queues exactly one follow-up **scan-all** (latest wins) — same slot semantics as today.
- Existing e2e testids stay (`unlocated-button`, `tray-panel`, `lightbox`, `grid-panel`, `#date-from`, `#date-to`); new testids: `source-list`, `add-source-input`, `add-source-submit`. FirstRun keeps `folder-input`/`folder-submit`.
- Work on a feature branch (e.g. `feature/multi-source`), conventional commits, commit per task.
- Full verification for frontend tasks: `npm run build -w web`, `npm test -w web`, `npm test -w server`; e2e (`npm run e2e`) runs in Tasks 5 (must still pass with rewritten seeding) — no, e2e is only rewritten in Task 8; between Tasks 5–7 the e2e suite is EXPECTED to fail (it still PUTs /api/config) — do not run it until Task 8, where it is updated and must pass.

## File Structure

```
server/src/db.ts            # + sources schema/migration, CRUD, enabled-filtered queries, scoped getIndexState
server/src/sources.ts       # NEW: findNestingConflict (pure path logic)
server/src/scanner.ts       # scanFolder(db, sourceId, folder, …) + listPhotoFiles
server/src/scan-manager.ts  # start(db, onlySourceId?) — scan-all with aggregation + per-source errors
server/src/app.ts           # sources CRUD routes, config routes removed, legacy adoption at startup
server/tests/db.test.ts, sources.test.ts (NEW), scanner.test.ts, scanner-stat-failure.test.ts,
server/tests/scan-manager.test.ts, app.test.ts        # updated/rewritten per task
web/src/api.ts              # Source type + fetchSources/addSource/patchSource/deleteSource; Config/putConfig removed
web/src/App.tsx             # sources state, multi-source banner, FirstRun gating on empty sources
web/src/components/FirstRun.tsx      # submits POST /api/sources
web/src/components/SettingsSheet.tsx # source manager (list, eye toggle, remove, add, rescan-all)
web/src/components/MapView.tsx       # drop the points.length guard (empty library must clear markers)
web/src/styles.css          # source-row styles
e2e/photo-map.spec.ts       # seeding via POST /api/sources + new multi-source test
README.md                   # multi-folder mention
```

---

### Task 1: DB layer — sources schema, migration, CRUD, enabled-filtered queries

**Files:**
- Modify: `server/src/db.ts` (replace entire file with the version below)
- Test: `server/tests/db.test.ts` (replace entire file with the version below)

**Interfaces:**
- Consumes: `PhotoRecord` from `server/src/exif.ts` (unchanged).
- Produces (relied on by Tasks 3–5):
  - `interface SourceRow { id: number; path: string; enabled: boolean; photoCount: number }`
  - `listSources(db): SourceRow[]` (ordered by id, photoCount via LEFT JOIN)
  - `addSource(db, path: string): SourceRow`
  - `removeSource(db, id: number): boolean` — transactional cascade; false if unknown
  - `setSourceEnabled(db, id: number, enabled: boolean): boolean` — false if unknown
  - `sourceExists(db, id: number): boolean`
  - `adoptLegacyPhotoDir(db, photoDir: string): void` — insert source + backfill ALL photo rows
  - CHANGED signatures: `upsertPhoto(db, p: PhotoRecord, sourceId: number)`, `getIndexState(db, sourceId: number)`
  - `getPoints` / `getUnlocated` / `getDateBounds` unchanged signatures, now enabled-filtered.

- [ ] **Step 1: Replace the test file**

`server/tests/db.test.ts` (entire new content):
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: db.test.ts FAILS (missing exports `addSource` etc., wrong `upsertPhoto` arity). scanner/scan-manager/app tests still pass (they compile against the old signatures — they break only after Step 3; that is expected and fixed in Tasks 3–5, but Step 4 below keeps this task green).

- [ ] **Step 3: Replace the implementation**

`server/src/db.ts` (entire new content):
```ts
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
      id INTEGER PRIMARY KEY,
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
```

- [ ] **Step 4: Temporarily bridge the compile break in dependent files**

`scanner.ts`, `scan-manager.ts`, and `app.ts` still call the old signatures and won't typecheck. To keep THIS task's commit green without doing Tasks 3–5 early, apply these minimal bridges (each replaced properly in its own task):

In `server/src/scanner.ts` line 36 and 61 (inside `scanFolder`), change:
```ts
const known = getIndexState(db)
```
to
```ts
const known = getIndexState(db, 0) // BRIDGE(Task 3): scanner becomes source-scoped in Task 3
```
and
```ts
upsertPhoto(db, record)
```
to
```ts
upsertPhoto(db, record, 0) // BRIDGE(Task 3)
```

These bridges make legacy `scanFolder` write invisible rows (source_id 0), which breaks the behavior of scanner/scan-manager/app tests. Therefore ALSO apply Step 5's test skips.

- [ ] **Step 5: Skip the suites that Tasks 3–5 will rewrite**

At the top of each of `server/tests/scanner.test.ts`, `server/tests/scanner-stat-failure.test.ts`, `server/tests/scan-manager.test.ts`, `server/tests/app.test.ts`, change the vitest import to include `describe` if absent and wrap nothing — instead simply replace every top-level `it(` with `it.skip(` **via a single marker**: add this line directly under the imports of each file:

```ts
// SKIPPED(Task 1 bridge): this suite is rewritten for multi-source in a later task.
```

and change `it(` → `it.skip(` throughout those four files (mechanical find/replace within each file; scanner-stat-failure has 1 test, scanner 6, scan-manager 1, app 14).

- [ ] **Step 6: Run tests to verify green**

Run: `npm test -w server` and `npm run typecheck -w server`
Expected: db.test.ts + all other suites PASS (skipped tests reported as skipped), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/db.ts server/src/scanner.ts server/tests
git commit -m "feat: sources table, legacy migration, and enabled-filtered photo queries"
```

---

### Task 2: Nested-path conflict helper

**Files:**
- Create: `server/src/sources.ts`
- Test: `server/tests/sources.test.ts`

**Interfaces:**
- Produces: `findNestingConflict(existingPaths: string[], candidate: string): string | null` — returns the first existing path that equals, contains, or is contained by the candidate (after `path.resolve`, separator-boundary aware), else null. Consumed by Task 5's POST /api/sources.

- [ ] **Step 1: Write the failing tests**

`server/tests/sources.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { findNestingConflict } from '../src/sources.js'

describe('findNestingConflict', () => {
  it('accepts unrelated and sibling paths', () => {
    expect(findNestingConflict(['/photos/trips'], '/photos/family')).toBeNull()
    expect(findNestingConflict([], '/anything')).toBeNull()
  })
  it('rejects an identical path', () => {
    expect(findNestingConflict(['/photos'], '/photos')).toBe('/photos')
  })
  it('rejects a candidate inside an existing source', () => {
    expect(findNestingConflict(['/photos'], '/photos/trips')).toBe('/photos')
  })
  it('rejects a candidate containing an existing source', () => {
    expect(findNestingConflict(['/photos/trips'], '/photos')).toBe('/photos/trips')
  })
  it('does not treat a common string prefix as nesting', () => {
    expect(findNestingConflict(['/a/b'], '/a/bc')).toBeNull()
    expect(findNestingConflict(['/a/bc'], '/a/b')).toBeNull()
  })
  it('normalizes trailing slashes and dots via resolve', () => {
    expect(findNestingConflict(['/photos'], '/photos/trips/../trips/')).toBe('/photos')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — cannot find module `../src/sources.js`.

- [ ] **Step 3: Implement**

`server/src/sources.ts`:
```ts
import { resolve, sep } from 'node:path'

/**
 * Overlapping sources are rejected so every photo belongs to exactly one source.
 * Returns the first existing path that equals, contains, or is contained by the
 * candidate (separator-boundary aware), or null when there is no conflict.
 */
export function findNestingConflict(existingPaths: string[], candidate: string): string | null {
  const cand = resolve(candidate)
  for (const existing of existingPaths) {
    const ex = resolve(existing)
    if (ex === cand || cand.startsWith(ex + sep) || ex.startsWith(cand + sep)) return existing
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/sources.ts server/tests/sources.test.ts
git commit -m "feat: separator-aware nested-source conflict detection"
```

---

### Task 3: Source-scoped scanner + listPhotoFiles

**Files:**
- Modify: `server/src/scanner.ts` (replace entire file)
- Test: `server/tests/scanner.test.ts` (replace entire file), `server/tests/scanner-stat-failure.test.ts` (replace entire file)

**Interfaces:**
- Consumes: `getIndexState(db, sourceId)`, `upsertPhoto(db, p, sourceId)`, `sourceExists(db, id)`, `addSource`, `removeSource` (Task 1).
- Produces (relied on by Task 4):
  - `listPhotoFiles(folder: string): Promise<string[]>` — recursive, extension-filtered; rejects if the folder is unreadable.
  - `scanFolder(db, sourceId: number, folder: string, onProgress?: (done, total) => void, precomputedFiles?: string[]): Promise<ScanResult>` — stamps sourceId, sweep scoped to the source and skipped entirely when the source no longer exists.
  - `ScanResult` unchanged.

- [ ] **Step 1: Replace the scanner tests**

`server/tests/scanner.test.ts` (entire new content — note: remove the `it.skip` bridge from Task 1 by replacing the whole file):
```ts
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it } from 'vitest'
import { addSource, getPoints, getUnlocated, openDb, removeSource } from '../src/db.js'
import { listPhotoFiles, scanFolder } from '../src/scanner.js'
import { makeJpeg } from './helpers/fixtures.js'

let db: ReturnType<typeof openDb>
let dir: string
let sourceId: number

beforeEach(async () => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'yufu-scan-'))
  sourceId = addSource(db, dir).id
  mkdirSync(join(dir, 'sub'))
  await makeJpeg(join(dir, 'a.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(dir, 'sub', 'b.jpeg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(dir, 'nogps.jpg'), { takenAt: '2024:01:01 10:00:00' })
  await writeFile(join(dir, 'notes.txt'), 'ignored')
})

it('initial scan indexes recursively, skips non-photo files', async () => {
  const r = await scanFolder(db, sourceId, dir)
  expect(r).toMatchObject({ scanned: 3, added: 3, updated: 0, removed: 0, skippedUnreadable: 0 })
  expect(getPoints(db)).toHaveLength(2)
  expect(getUnlocated(db, {}).total).toBe(1)
})

it('rescan skips unchanged files', async () => {
  await scanFolder(db, sourceId, dir)
  const r = await scanFolder(db, sourceId, dir)
  expect(r).toMatchObject({ scanned: 3, added: 0, updated: 0, removed: 0 })
})

it('re-extracts a modified file', async () => {
  await scanFolder(db, sourceId, dir)
  await makeJpeg(join(dir, 'a.jpg'), { lat: 35.6, lon: 139.7, takenAt: '2025:01:01 10:00:00' })
  const future = new Date(Date.now() + 60_000)
  await utimes(join(dir, 'a.jpg'), future, future)
  const r = await scanFolder(db, sourceId, dir)
  expect(r.updated).toBe(1)
  expect(getPoints(db).some((p) => Math.abs(p.lat - 35.6) < 0.01)).toBe(true)
})

it('removes deleted files from the index', async () => {
  await scanFolder(db, sourceId, dir)
  await rm(join(dir, 'a.jpg'))
  const r = await scanFolder(db, sourceId, dir)
  expect(r.removed).toBe(1)
  expect(getPoints(db)).toHaveLength(1)
})

it('counts unreadable files without aborting', async () => {
  await writeFile(join(dir, 'corrupt.jpg'), 'nope')
  const r = await scanFolder(db, sourceId, dir)
  expect(r.skippedUnreadable).toBe(1)
  expect(r.added).toBe(3)
})

it('reports progress', async () => {
  const calls: [number, number][] = []
  await scanFolder(db, sourceId, dir, (done, total) => calls.push([done, total]))
  expect(calls.length).toBe(3)
  expect(calls.at(-1)).toEqual([3, 3])
})

it('accepts a precomputed file list', async () => {
  const files = await listPhotoFiles(dir)
  expect(files).toHaveLength(3)
  const r = await scanFolder(db, sourceId, dir, undefined, files)
  expect(r.added).toBe(3)
})

it('deletion sweep only touches its own source', async () => {
  const otherDir = mkdtempSync(join(tmpdir(), 'yufu-scan-other-'))
  await makeJpeg(join(otherDir, 'o.jpg'), { lat: 1, lon: 1, takenAt: '2022:01:01 10:00:00' })
  const otherId = addSource(db, otherDir).id
  await scanFolder(db, sourceId, dir)
  await scanFolder(db, otherId, otherDir)
  await rm(join(dir, 'a.jpg'))
  const r = await scanFolder(db, sourceId, dir)
  expect(r.removed).toBe(1)
  expect(getPoints(db)).toHaveLength(2) // sub/b.jpeg + the other source's o.jpg
})

it('skips the deletion sweep when the source was removed mid-scan', async () => {
  await scanFolder(db, sourceId, dir)
  removeSource(db, sourceId)
  const r = await scanFolder(db, sourceId, dir) // stale id
  expect(r.removed).toBe(0)
  expect(getPoints(db)).toHaveLength(0) // orphan rows belong to no enabled source
})
```

`server/tests/scanner-stat-failure.test.ts` (entire new content):
```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { addSource, openDb } from '../src/db.js'
import { makeJpeg } from './helpers/fixtures.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: vi.fn((p: Parameters<typeof actual.stat>[0]) =>
      String(p).endsWith('vanishes.jpg')
        ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        : actual.stat(p),
    ),
  }
})

// Import after mocking so scanFolder picks up the mocked node:fs/promises.
const { scanFolder } = await import('../src/scanner.js')

let db: ReturnType<typeof openDb>
let dir: string
let sourceId: number

beforeEach(async () => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'yufu-scan-stat-'))
  sourceId = addSource(db, dir).id
  await makeJpeg(join(dir, 'a.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(dir, 'b.jpg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(dir, 'vanishes.jpg'), { takenAt: '2024:01:01 10:00:00' })
})

it('survives a file disappearing between readdir and stat', async () => {
  const calls: [number, number][] = []
  const r = await scanFolder(db, sourceId, dir, (done, total) => calls.push([done, total]))
  expect(r.skippedUnreadable).toBe(1)
  expect(r.added).toBe(2)
  expect(calls.at(-1)).toEqual([3, 3])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: both scanner suites FAIL (`listPhotoFiles` not exported; `scanFolder` arity).

- [ ] **Step 3: Replace the implementation**

`server/src/scanner.ts` (entire new content):
```ts
import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { deleteByPaths, getIndexState, sourceExists, upsertPhoto, type Db } from './db.js'
import { extractPhotoRecord } from './exif.js'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const CONCURRENCY = 8

export interface ScanResult {
  scanned: number
  added: number
  updated: number
  removed: number
  skippedUnreadable: number
}

export type ProgressFn = (done: number, total: number) => void

/** Recursive photo-file listing; rejects when the folder is unreadable. */
export async function listPhotoFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map((e) => join(e.parentPath, e.name))
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        await fn(items[idx])
      }
    }),
  )
}

export async function scanFolder(
  db: Db,
  sourceId: number,
  folder: string,
  onProgress?: ProgressFn,
  precomputedFiles?: string[],
): Promise<ScanResult> {
  const files = precomputedFiles ?? (await listPhotoFiles(folder))
  const known = getIndexState(db, sourceId)
  const result: ScanResult = { scanned: files.length, added: 0, updated: 0, removed: 0, skippedUnreadable: 0 }
  const seen = new Set<string>()
  let done = 0

  await mapPool(files, CONCURRENCY, async (file) => {
    seen.add(file)
    const prev = known.get(file)
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(file)
    } catch {
      result.skippedUnreadable++
      done++
      onProgress?.(done, files.length)
      return
    }
    if (prev && prev.mtime === Math.round(st.mtimeMs) && prev.size === st.size) {
      done++
      onProgress?.(done, files.length)
      return
    }
    const record = await extractPhotoRecord(file)
    if (record === null) result.skippedUnreadable++
    else {
      upsertPhoto(db, record, sourceId)
      if (prev) result.updated++
      else result.added++
    }
    done++
    onProgress?.(done, files.length)
  })

  // Guard against a source deleted while this scan was running: without it the
  // sweep below would be based on a stale state map. A rare orphan upsert is
  // acceptable — orphans match no enabled source and vanish on the next scan.
  if (sourceExists(db, sourceId)) {
    const removedPaths = [...known.keys()].filter((p) => !seen.has(p))
    deleteByPaths(db, removedPaths)
    result.removed = removedPaths.length
  }
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: db, sources, both scanner suites PASS. scan-manager and app suites still skipped (Tasks 4–5). Typecheck note: `scan-manager.ts` still calls `scanFolder(db, folder, cb)` with the old arity — fix the call as a bridge: change that line to `scanFolder(db, 0, folder, (done, total) => { ... })` with comment `// BRIDGE(Task 4)`. `app.test.ts` remains skipped so behavior doesn't matter yet. Run `npm run typecheck -w server` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/scanner.ts server/src/scan-manager.ts server/tests
git commit -m "feat: source-scoped scanner with precomputed file lists and sweep guard"
```

---

### Task 4: ScanManager — scan all enabled sources with aggregated progress

**Files:**
- Modify: `server/src/scan-manager.ts` (replace entire file)
- Test: `server/tests/scan-manager.test.ts` (replace entire file)

**Interfaces:**
- Consumes: `listSources`, `SourceRow` (Task 1); `listPhotoFiles`, `scanFolder`, `ScanResult` (Task 3).
- Produces (relied on by Task 5 and the frontend's `/api/scan/status` consumers):
  - `interface SourceScanOutcome { sourceId: number; path: string; result?: ScanResult; error?: string }`
  - `interface ScanAllResult extends ScanResult { perSource: SourceScanOutcome[] }` — top-level counters are totals across sources, so existing consumers of `lastResult.skippedUnreadable` etc. keep working.
  - `ScanManager.start(db: Db, onlySourceId?: number): Promise<boolean>` — scans all enabled sources (or just one, for a newly added source); when already running, queues one follow-up **scan-all** (latest wins) and returns true. Events unchanged: `progress` {done,total} (globally aggregated), `done` ScanAllResult, `failed` {message}.

- [ ] **Step 1: Replace the tests**

`server/tests/scan-manager.test.ts` (entire new content):
```ts
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { addSource, getPoints, getUnlocated, openDb } from '../src/db.js'
import { ScanManager, type ScanAllResult } from '../src/scan-manager.js'
import { makeJpeg } from './helpers/fixtures.js'

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'yufu-scanmgr-'))
}

it('scans all enabled sources with globally aggregated progress', async () => {
  const root = makeRoot()
  const folderA = join(root, 'a')
  const folderB = join(root, 'b')
  mkdirSync(folderA)
  mkdirSync(folderB)
  await makeJpeg(join(folderA, 'a1.jpg'), { lat: 41, lon: 29, takenAt: '2023:01:01 10:00:00' })
  await makeJpeg(join(folderA, 'a2.jpg'), { takenAt: '2023:01:02 10:00:00' })
  await makeJpeg(join(folderB, 'b1.jpg'), { lat: 40.7, lon: -74, takenAt: '2024:01:01 10:00:00' })

  const db = openDb(':memory:')
  addSource(db, folderA)
  addSource(db, folderB)
  const mgr = new ScanManager()
  const progress: [number, number][] = []
  mgr.on('progress', (p: { done: number; total: number }) => progress.push([p.done, p.total]))

  await mgr.start(db)
  const result = mgr.lastResult as ScanAllResult
  expect(result.added).toBe(3)
  expect(result.perSource).toHaveLength(2)
  expect(result.perSource.every((s) => s.result && !s.error)).toBe(true)
  expect(progress.every(([, total]) => total === 3)).toBe(true)
  expect(progress.at(-1)).toEqual([3, 3])
  expect(getPoints(db)).toHaveLength(2)
  expect(getUnlocated(db, {}).total).toBe(1)
})

it('skips disabled sources and honors onlySourceId', async () => {
  const root = makeRoot()
  const folderA = join(root, 'a')
  const folderB = join(root, 'b')
  mkdirSync(folderA)
  mkdirSync(folderB)
  await makeJpeg(join(folderA, 'a1.jpg'), { lat: 41, lon: 29, takenAt: '2023:01:01 10:00:00' })
  await makeJpeg(join(folderB, 'b1.jpg'), { lat: 40.7, lon: -74, takenAt: '2024:01:01 10:00:00' })

  const db = openDb(':memory:')
  addSource(db, folderA)
  const b = addSource(db, folderB)
  const mgr = new ScanManager()

  await mgr.start(db, b.id)
  expect((mgr.lastResult as ScanAllResult).perSource).toHaveLength(1)
  expect((mgr.lastResult as ScanAllResult).perSource[0].sourceId).toBe(b.id)
  expect(getPoints(db)).toHaveLength(1)
})

it('an unreachable source is reported per-source and does not abort the others', async () => {
  const root = makeRoot()
  const good = join(root, 'good')
  const gone = join(root, 'gone')
  mkdirSync(good)
  mkdirSync(gone)
  await makeJpeg(join(good, 'g.jpg'), { lat: 41, lon: 29, takenAt: '2023:01:01 10:00:00' })

  const db = openDb(':memory:')
  addSource(db, gone)
  addSource(db, good)
  rmSync(gone, { recursive: true })
  const mgr = new ScanManager()

  const ok = await mgr.start(db)
  expect(ok).toBe(true)
  const result = mgr.lastResult as ScanAllResult
  expect(result.perSource).toHaveLength(2)
  const failed = result.perSource.find((s) => s.error)
  const succeeded = result.perSource.find((s) => s.result)
  expect(failed?.path).toBe(gone)
  expect(succeeded?.result?.added).toBe(1)
  expect(getPoints(db)).toHaveLength(1)
})

it('queues a start() issued while a scan is running as one follow-up scan-all', async () => {
  const root = makeRoot()
  const folderA = join(root, 'a')
  const folderB = join(root, 'b')
  mkdirSync(folderA)
  mkdirSync(folderB)
  await makeJpeg(join(folderA, 'a1.jpg'), { takenAt: '2023:01:01 10:00:00' })
  await makeJpeg(join(folderA, 'a2.jpg'), { takenAt: '2023:01:02 10:00:00' })

  const db = openDb(':memory:')
  const a = addSource(db, folderA)
  const mgr = new ScanManager()
  let doneCount = 0
  mgr.on('done', () => doneCount++)

  const first = mgr.start(db, a.id)
  expect(mgr.running).toBe(true)
  // Add a source mid-scan (as POST /api/sources does) and request its scan:
  // it must queue a follow-up scan-all rather than being dropped.
  const b = addSource(db, folderB)
  await makeJpeg(join(folderB, 'b1.jpg'), { lat: 41, lon: 29, takenAt: '2024:01:01 10:00:00' })
  const accepted = await mgr.start(db, b.id)
  expect(accepted).toBe(true)
  await first

  await expect
    .poll(() => !mgr.running && getPoints(db).length === 1 && getUnlocated(db, {}).total === 2, {
      timeout: 10_000,
    })
    .toBe(true)
  expect(doneCount).toBe(2)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: scan-manager suite FAILS (no `ScanAllResult` export; `start` signature).

- [ ] **Step 3: Replace the implementation**

`server/src/scan-manager.ts` (entire new content):
```ts
import { EventEmitter } from 'node:events'
import { listSources, type Db, type SourceRow } from './db.js'
import { listPhotoFiles, scanFolder, type ScanResult } from './scanner.js'

export interface SourceScanOutcome {
  sourceId: number
  path: string
  result?: ScanResult
  error?: string
}

export interface ScanAllResult extends ScanResult {
  perSource: SourceScanOutcome[]
}

export class ScanManager extends EventEmitter {
  running = false
  progress = { done: 0, total: 0 }
  lastResult: ScanAllResult | null = null
  private queued: { db: Db } | null = null

  /**
   * Scan every enabled source (or a single one, for a source that was just
   * added). Requests during a running scan queue one follow-up scan-all.
   */
  async start(db: Db, onlySourceId?: number): Promise<boolean> {
    if (this.running) {
      this.queued = { db }
      return true
    }
    this.running = true
    this.progress = { done: 0, total: 0 }
    try {
      let sources = listSources(db).filter((s) => s.enabled)
      if (onlySourceId !== undefined) sources = sources.filter((s) => s.id === onlySourceId)

      const perSource: SourceScanOutcome[] = []
      // List every source first so the progress total is global.
      const listed: { source: SourceRow; files: string[] }[] = []
      for (const source of sources) {
        try {
          listed.push({ source, files: await listPhotoFiles(source.path) })
        } catch (err) {
          perSource.push({ sourceId: source.id, path: source.path, error: (err as Error).message })
        }
      }
      const total = listed.reduce((n, l) => n + l.files.length, 0)
      const totals: ScanAllResult = { scanned: 0, added: 0, updated: 0, removed: 0, skippedUnreadable: 0, perSource }

      let offset = 0
      for (const { source, files } of listed) {
        const result = await scanFolder(
          db,
          source.id,
          source.path,
          (done) => {
            this.progress = { done: offset + done, total }
            this.emit('progress', this.progress)
          },
          files,
        )
        offset += files.length
        totals.scanned += result.scanned
        totals.added += result.added
        totals.updated += result.updated
        totals.removed += result.removed
        totals.skippedUnreadable += result.skippedUnreadable
        perSource.push({ sourceId: source.id, path: source.path, result })
      }

      this.progress = { done: total, total }
      this.lastResult = totals
      this.emit('done', totals)
      return true
    } catch (err) {
      this.emit('failed', { message: (err as Error).message })
      return false
    } finally {
      this.running = false
      const next = this.queued
      if (next) {
        this.queued = null
        void this.start(next.db)
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server` then `npm run typecheck -w server`
Expected: scan-manager suite PASSES (remove any leftover `it.skip` markers from Task 1 — the file was fully replaced). Typecheck: `app.ts` still calls `scanManager.start(db, photoDir)` with a string — bridge it: in `app.ts` change both `void scanManager.start(db, body.photoDir)` and `void scanManager.start(db, photoDir)` to `void scanManager.start(db)` with comment `// BRIDGE(Task 5)`. app.test.ts remains skipped. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/scan-manager.ts server/src/app.ts server/tests/scan-manager.test.ts
git commit -m "feat: scan manager runs all enabled sources with aggregated progress"
```

---

### Task 5: API — sources CRUD, config routes removed, legacy adoption

**Files:**
- Modify: `server/src/app.ts` (replace entire file)
- Test: `server/tests/app.test.ts` (replace entire file)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces (relied on by the frontend, Tasks 6–8):
  - `GET /api/sources` → `Array<{ id, path, enabled, photoCount, exists }>`
  - `POST /api/sources` body `{path}` → 201 `{id, path, enabled, photoCount, exists: true}` | 400 `{error}` | 409 `{error}` (nested/duplicate); kicks off a scan of just that source
  - `PATCH /api/sources/:id` body `{enabled: boolean}` → `{id, enabled}` | 400 | 404
  - `DELETE /api/sources/:id` → `{removed: true}` | 404
  - `POST /api/scan` → 202 (scan-all) | 400 `no sources configured` | 409 running
  - `GET /api/config` and `PUT /api/config` REMOVED (404 via not-found handler)
  - Startup: legacy `config.photoDir` adopted into a source once; `photoDir` cleared from config.json.
  - Everything else (`/api/photos*`, `/api/library`, `/thumb/:id`, `/api/scan/status`, `/api/scan/events`, static) unchanged.

- [ ] **Step 1: Replace the API tests**

`server/tests/app.test.ts` (entire new content):
```ts
import type { FastifyInstance } from 'fastify'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig, saveConfig } from '../src/config.js'
import { makeJpeg } from './helpers/fixtures.js'

let app: FastifyInstance
let photoDir: string
let sourceId: number

async function waitForScan(a: FastifyInstance) {
  for (let i = 0; i < 200; i++) {
    const res = await a.inject({ method: 'GET', url: '/api/scan/status' })
    const s = res.json()
    if (!s.running && s.lastResult) return s.lastResult
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('scan did not finish')
}

beforeAll(async () => {
  photoDir = mkdtempSync(join(tmpdir(), 'yufu-api-photos-'))
  await makeJpeg(join(photoDir, 'geo.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(photoDir, 'geo2.jpg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(photoDir, 'nogps.jpg'), { takenAt: '2024:01:01 10:00:00' })
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'yufu-api-data-')) })
})

it('starts with no sources', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sources' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual([])
})

it('POST /api/sources rejects a non-directory', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: '/definitely/not/a/dir' } })
  expect(res.statusCode).toBe(400)
})

it('POST /api/sources adds a folder and triggers its scan', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: photoDir } })
  expect(res.statusCode).toBe(201)
  const source = res.json()
  sourceId = source.id
  expect(source).toMatchObject({ path: photoDir, enabled: true, exists: true })
  const result = await waitForScan(app)
  expect(result.added).toBe(3)
  const list = (await app.inject({ method: 'GET', url: '/api/sources' })).json()
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ id: sourceId, photoCount: 3, enabled: true, exists: true })
})

it('POST /api/sources rejects nested and duplicate paths with 409', async () => {
  const dup = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: photoDir } })
  expect(dup.statusCode).toBe(409)
  const nested = join(photoDir, 'sub')
  mkdirSync(nested)
  const child = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: nested } })
  expect(child.statusCode).toBe(409)
  expect(child.json().error).toContain(photoDir)
})

it('GET /api/photos returns geolocated points', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos' })
  const points = res.json()
  expect(points).toHaveLength(2)
  expect(points[0]).toHaveProperty('takenAt')
})

it('GET /api/photos/unlocated filters by range', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated' })
  expect(res.json().total).toBe(1)
  const none = await app.inject({ method: 'GET', url: '/api/photos/unlocated?from=0&to=1000' })
  expect(none.json().total).toBe(0)
})

it('GET /api/photos/:id returns detail or 404', async () => {
  const points = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  const res = await app.inject({ method: 'GET', url: `/api/photos/${points[0].id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toHaveProperty('path')
  expect((await app.inject({ method: 'GET', url: '/api/photos/99999' })).statusCode).toBe(404)
})

it('GET /thumb/:id serves a jpeg and validates size', async () => {
  const points = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  const ok = await app.inject({ method: 'GET', url: `/thumb/${points[0].id}?size=96` })
  expect(ok.statusCode).toBe(200)
  expect(ok.headers['content-type']).toContain('image/jpeg')
  const bad = await app.inject({ method: 'GET', url: `/thumb/${points[0].id}?size=123` })
  expect(bad.statusCode).toBe(400)
  const missing = await app.inject({ method: 'GET', url: '/thumb/99999?size=96' })
  expect(missing.statusCode).toBe(404)
})

it('PATCH /api/sources/:id toggles visibility and filters every photo query', async () => {
  const off = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: false } })
  expect(off.statusCode).toBe(200)
  expect(off.json()).toEqual({ id: sourceId, enabled: false })
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'GET', url: '/api/photos/unlocated' })).json().total).toBe(0)
  expect((await app.inject({ method: 'GET', url: '/api/library' })).json()).toEqual({ bounds: null })

  const on = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: true } })
  expect(on.statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(2)
})

it('PATCH validates body and id', async () => {
  const badBody = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: 'yes' } })
  expect(badBody.statusCode).toBe(400)
  const badId = await app.inject({ method: 'PATCH', url: '/api/sources/999', payload: { enabled: true } })
  expect(badId.statusCode).toBe(404)
})

it('POST /api/scan rescans all enabled sources', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan' })
  expect(res.statusCode).toBe(202)
  const result = await waitForScan(app)
  expect(result.scanned).toBe(3)
  expect(result.perSource).toHaveLength(1)
})

it('config routes are gone', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(404)
  expect((await app.inject({ method: 'PUT', url: '/api/config', payload: { photoDir } })).statusCode).toBe(404)
})

it('GET /api/sources reports exists=false for a vanished folder', async () => {
  const data = mkdtempSync(join(tmpdir(), 'yufu-api-orphan-'))
  const gone = join(data, 'gone')
  mkdirSync(gone)
  const a = await buildApp({ dataDir: data })
  await a.inject({ method: 'POST', url: '/api/sources', payload: { path: gone } })
  rmSync(gone, { recursive: true })
  const res = await a.inject({ method: 'GET', url: '/api/sources' })
  expect(res.json()[0]).toMatchObject({ exists: false })
})

it('adopts a legacy config.photoDir into a source at startup and clears it', async () => {
  const data = mkdtempSync(join(tmpdir(), 'yufu-api-legacy-'))
  const legacyDir = mkdtempSync(join(tmpdir(), 'yufu-api-legacy-photos-'))
  saveConfig(data, { photoDir: legacyDir })
  const a = await buildApp({ dataDir: data })
  const sources = (await a.inject({ method: 'GET', url: '/api/sources' })).json()
  expect(sources).toHaveLength(1)
  expect(sources[0]).toMatchObject({ path: legacyDir, enabled: true })
  expect(loadConfig(data)).toEqual({ photoDir: null })
  // Second boot on the same dataDir must not duplicate the source.
  const again = await buildApp({ dataDir: data })
  expect((await again.inject({ method: 'GET', url: '/api/sources' })).json()).toHaveLength(1)
})

it('DELETE /api/sources/:id removes the source and its photos', async () => {
  const del = await app.inject({ method: 'DELETE', url: `/api/sources/${sourceId}` })
  expect(del.statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/sources' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'DELETE', url: `/api/sources/${sourceId}` })).statusCode).toBe(404)
})

it('POST /api/scan without sources is a 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan' })
  expect(res.statusCode).toBe(400)
})

it('GET /api/photos/unlocated rejects non-numeric from', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?from=abc' })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid query parameter' })
})

it('GET /api/photos/unlocated rejects negative page', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?page=-1' })
  expect(res.statusCode).toBe(400)
})

it('GET /api/photos/:id and /thumb/:id return 404 for non-numeric ids', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/photos/abc' })).statusCode).toBe(404)
  expect((await app.inject({ method: 'GET', url: '/thumb/abc?size=96' })).statusCode).toBe(404)
})

it('GET /api/library returns date bounds spanning unlocated photos', async () => {
  const isolatedPhotoDir = mkdtempSync(join(tmpdir(), 'yufu-api-bounds-photos-'))
  await makeJpeg(join(isolatedPhotoDir, 'geo.jpg'), { lat: 41, lon: 29, takenAt: '2024:06:01 10:00:00' })
  await makeJpeg(join(isolatedPhotoDir, 'nogps.jpg'), { takenAt: '2020:01:01 10:00:00' })
  const isolatedApp = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'yufu-api-bounds-data-')) })
  await isolatedApp.inject({ method: 'POST', url: '/api/sources', payload: { path: isolatedPhotoDir } })
  await waitForScan(isolatedApp)
  const { bounds } = (await isolatedApp.inject({ method: 'GET', url: '/api/library' })).json()
  expect(bounds[0]).toBeLessThan(bounds[1])
  expect(new Date(bounds[0]).getUTCFullYear()).toBe(2020)
  expect(new Date(bounds[1]).getUTCFullYear()).toBe(2024)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: app suite FAILS (no /api/sources routes; config routes still present).

- [ ] **Step 3: Replace the app**

`server/src/app.ts` (entire new content):
```ts
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import {
  addSource, adoptLegacyPhotoDir, getDateBounds, getPhoto, getPoints, getUnlocated,
  listSources, openDb, removeSource, setSourceEnabled,
} from './db.js'
import { ScanManager } from './scan-manager.js'
import { findNestingConflict } from './sources.js'
import { getThumbPath, THUMB_SIZES } from './thumbs.js'

export interface AppContext {
  dataDir: string
  webDist?: string
}

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  mkdirSync(ctx.dataDir, { recursive: true })
  const db = openDb(join(ctx.dataDir, 'index.db'))

  // One-time adoption of the pre-multi-source config: photoDir becomes source 1.
  const legacy = loadConfig(ctx.dataDir)
  if (legacy.photoDir && listSources(db).length === 0) {
    adoptLegacyPhotoDir(db, legacy.photoDir)
    saveConfig(ctx.dataDir, { photoDir: null })
  }

  const scanManager = new ScanManager()
  const app = Fastify()

  app.get('/health', async () => ({ ok: true }))

  app.get('/api/sources', async () => {
    const sources = listSources(db)
    return Promise.all(
      sources.map(async (s) => {
        const st = await stat(s.path).catch(() => null)
        return { ...s, exists: st?.isDirectory() ?? false }
      }),
    )
  })

  app.post('/api/sources', async (req, reply) => {
    const body = req.body as { path?: unknown }
    if (typeof body?.path !== 'string' || body.path.trim() === '') {
      return reply.code(400).send({ error: 'path required' })
    }
    const path = resolve(body.path.trim())
    const st = await stat(path).catch(() => null)
    if (!st?.isDirectory()) return reply.code(400).send({ error: 'not a directory' })
    const conflict = findNestingConflict(listSources(db).map((s) => s.path), path)
    if (conflict) return reply.code(409).send({ error: `overlaps existing source ${conflict}` })
    const source = addSource(db, path)
    void scanManager.start(db, source.id)
    return reply.code(201).send({ ...source, exists: true })
  })

  app.patch('/api/sources/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    const body = req.body as { enabled?: unknown }
    if (typeof body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled boolean required' })
    if (id === null || !setSourceEnabled(db, id, body.enabled)) {
      return reply.code(404).send({ error: 'not found' })
    }
    return { id, enabled: body.enabled }
  })

  app.delete('/api/sources/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    if (id === null || !removeSource(db, id)) return reply.code(404).send({ error: 'not found' })
    return { removed: true }
  })

  app.get('/api/photos', async () => getPoints(db))

  app.get('/api/library', async () => ({ bounds: getDateBounds(db) }))

  app.get('/api/photos/unlocated', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const from = q.from !== undefined ? Number(q.from) : undefined
    const to = q.to !== undefined ? Number(q.to) : undefined
    const page = q.page !== undefined ? Number(q.page) : 0
    if (
      (from !== undefined && !Number.isFinite(from)) ||
      (to !== undefined && !Number.isFinite(to)) ||
      !Number.isInteger(page) || page < 0
    ) {
      return reply.code(400).send({ error: 'invalid query parameter' })
    }
    return getUnlocated(db, { from, to, page })
  })

  app.get('/api/photos/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    const photo = id !== null ? getPhoto(db, id) : undefined
    if (!photo) return reply.code(404).send({ error: 'not found' })
    return photo
  })

  app.get('/thumb/:id', async (req, reply) => {
    const size = Number((req.query as { size?: string }).size ?? 256)
    if (!THUMB_SIZES.has(size)) return reply.code(400).send({ error: 'invalid size' })
    const id = parseId((req.params as { id: string }).id)
    const photo = id !== null ? getPhoto(db, id) : undefined
    if (!photo) return reply.code(404).send({ error: 'not found' })
    try {
      const p = await getThumbPath(join(ctx.dataDir, 'thumbs'), photo, size)
      return reply.type('image/jpeg').send(createReadStream(p))
    } catch {
      return reply.code(404).send({ error: 'unreadable source photo' })
    }
  })

  app.post('/api/scan', async (_req, reply) => {
    if (listSources(db).filter((s) => s.enabled).length === 0) {
      return reply.code(400).send({ error: 'no sources configured' })
    }
    if (scanManager.running) return reply.code(409).send({ error: 'scan in progress' })
    void scanManager.start(db)
    return reply.code(202).send({ started: true })
  })

  app.get('/api/scan/status', async () => ({
    running: scanManager.running,
    progress: scanManager.progress,
    lastResult: scanManager.lastResult,
  }))

  app.get('/api/scan/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    send('progress', scanManager.progress)
    const onProgress = (p: unknown) => send('progress', p)
    const onDone = (r: unknown) => send('done', r)
    const onFailed = (e: unknown) => send('failed', e)
    scanManager.on('progress', onProgress).on('done', onDone).on('failed', onFailed)
    req.raw.on('close', () => {
      scanManager.off('progress', onProgress).off('done', onDone).off('failed', onFailed)
    })
  })

  if (ctx.webDist && existsSync(ctx.webDist)) {
    await app.register(fastifyStatic, { root: ctx.webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not found' })
    })
  }

  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server` and `npm run typecheck -w server`
Expected: ALL server suites PASS (no skipped tests remain anywhere — verify with the output; the bridges from Tasks 1/3/4 are all gone). Do NOT run e2e yet (it still PUTs /api/config; Task 8 rewrites it).

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/tests/app.test.ts
git commit -m "feat: sources CRUD API with legacy photoDir adoption; config routes removed"
```

---

### Task 6: Frontend data layer + App + FirstRun + MapView empty-points fix

**Files:**
- Modify: `web/src/api.ts` (replace entire file), `web/src/App.tsx` (replace entire file), `web/src/components/FirstRun.tsx` (replace entire file), `web/src/components/MapView.tsx` (one effect)

**Interfaces:**
- Consumes: Task 5 routes.
- Produces (relied on by Task 7):
  - `interface Source { id: number; path: string; enabled: boolean; exists: boolean; photoCount: number }`
  - `fetchSources(): Promise<Source[]>`, `addSource(path): Promise<Response>`, `patchSource(id, enabled): Promise<Response>`, `deleteSource(id): Promise<Response>` in `web/src/api.ts`
  - App renders FirstRun when `sources.length === 0`; passes `sources` and `onChanged` to SettingsSheet (Task 7 changes SettingsSheet's props to match — until then the app won't compile, so Tasks 6 and 7 are committed TOGETHER; do not run the build until Task 7's files are in place, then verify both tasks' steps with one build).

**NOTE:** Tasks 6 and 7 form one compile unit (App references SettingsSheet's new props). Implement both, then verify and commit as two commits back-to-back (code of 6, then code of 7, single verification after 7). The task split exists for review scoping.

- [ ] **Step 1: Replace `web/src/api.ts`**

```ts
export interface Source {
  id: number
  path: string
  enabled: boolean
  exists: boolean
  photoCount: number
}
export interface PhotoPoint {
  id: number
  lat: number
  lon: number
  takenAt: number
}
export interface PhotoDetail {
  id: number
  path: string
  lat: number | null
  lon: number | null
  taken_at: number
  width: number
  height: number
}
export interface Library {
  /** Min/max takenAt across enabled sources (located or not); null when empty. */
  bounds: [number, number] | null
}
export interface UnlocatedResult {
  total: number
  photos: { id: number; path: string; takenAt: number; width: number; height: number }[]
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const fetchSources = () => get<Source[]>('/api/sources')
export const fetchPoints = () => get<PhotoPoint[]>('/api/photos')
export const fetchLibrary = () => get<Library>('/api/library')
export const fetchPhoto = (id: number) => get<PhotoDetail>(`/api/photos/${id}`)
export const fetchUnlocated = (q: { from?: number; to?: number; page?: number }) => {
  const params = new URLSearchParams()
  if (q.from !== undefined) params.set('from', String(q.from))
  if (q.to !== undefined) params.set('to', String(q.to))
  if (q.page !== undefined) params.set('page', String(q.page))
  return get<UnlocatedResult>(`/api/photos/unlocated?${params}`)
}
export const addSource = (path: string) => fetch('/api/sources', json('POST', { path }))
export const patchSource = (id: number, enabled: boolean) =>
  fetch(`/api/sources/${id}`, json('PATCH', { enabled }))
export const deleteSource = (id: number) => fetch(`/api/sources/${id}`, { method: 'DELETE' })
export const startScan = () => fetch('/api/scan', { method: 'POST' })
```

- [ ] **Step 2: Replace `web/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { fetchLibrary, fetchPoints, fetchSources, type PhotoPoint, type Source } from './api'
import { FirstRun } from './components/FirstRun'
import { GridPanel } from './components/GridPanel'
import { Lightbox } from './components/Lightbox'
import { MapView } from './components/MapView'
import { SettingsSheet } from './components/SettingsSheet'
import { TimelineBar } from './components/TimelineBar'
import { UnlocatedTray } from './components/UnlocatedTray'
import { histogram } from './lib/points'

export default function App() {
  const [sources, setSources] = useState<Source[] | undefined>(undefined)
  const [points, setPoints] = useState<PhotoPoint[]>([])
  const [span, setSpan] = useState<[number, number] | null>(null)
  const [range, setRange] = useState<[number, number] | null>(null)
  const [gridPhotos, setGridPhotos] = useState<{ id: number }[] | null>(null)
  const [lightbox, setLightbox] = useState<{ ids: number[]; index: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null)

  const loadLibrary = useCallback(async () => {
    const [pts, library] = await Promise.all([fetchPoints(), fetchLibrary()])
    setPoints(pts)
    // Bounds cover the whole enabled library (unlocated included), so an
    // all-unlocated folder still gets a timeline and tray.
    setSpan(library.bounds)
    setRange(library.bounds)
  }, [])

  const reloadSources = useCallback(() => {
    setLoadError(false)
    void fetchSources()
      .then((list) => {
        setSources(list)
        if (list.length > 0) void loadLibrary()
      })
      .catch(() => setLoadError(true))
  }, [loadLibrary])

  useEffect(() => {
    reloadSources()
  }, [reloadSources])

  if (loadError) {
    return (
      <div className="first-run">
        <h1>yufu</h1>
        <p>Can't reach the local server. Is it still running?</p>
        <button onClick={reloadSources}>Retry</button>
      </div>
    )
  }

  if (sources === undefined) return null

  if (sources.length === 0) {
    return <FirstRun onConfigured={reloadSources} />
  }

  const missing = sources.filter((s) => s.enabled && !s.exists)
  const bins = span ? histogram(points, span[0], span[1], 120) : []

  return (
    <>
      {missing.length > 0 && (
        <div className="banner">
          Photo folder “{missing[0].path}”
          {missing.length > 1 ? ` and ${missing.length - 1} more are` : ' is'} not reachable — showing
          the cached index.
          <button onClick={() => setSettingsOpen(true)}>Manage folders</button>
        </div>
      )}
      <MapView
        points={points}
        range={range}
        focus={focus}
        onOpenGrid={(photos) => setGridPhotos(photos)}
        onOpenPhoto={(id) => setLightbox({ ids: [id], index: 0 })}
      />
      {span && range && <TimelineBar span={span} range={range} bins={bins} onChange={setRange} />}
      {range && <UnlocatedTray range={range} onOpenPhoto={(ids, index) => setLightbox({ ids, index })} />}
      {gridPhotos && (
        <GridPanel
          photos={gridPhotos}
          onClose={() => setGridPhotos(null)}
          onPhoto={(i) => setLightbox({ ids: gridPhotos.map((p) => p.id), index: i })}
        />
      )}
      {lightbox && (
        <Lightbox
          ids={lightbox.ids}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox({ ...lightbox, index: i })}
          onShowOnMap={(lat, lon) => {
            setFocus((f) => ({ lat, lon, seq: (f?.seq ?? 0) + 1 }))
            setLightbox(null)
            setGridPhotos(null)
          }}
        />
      )}
      <button className="settings-button" title="Settings" onClick={() => setSettingsOpen(true)}>
        ⚙︎
      </button>
      {settingsOpen && (
        <SettingsSheet
          sources={sources}
          onClose={() => setSettingsOpen(false)}
          onChanged={reloadSources}
        />
      )}
    </>
  )
}
```

Note: `reloadSources` covers both "sources changed" and "scan finished" (it reloads the library). When every source is disabled or a source is emptied, `bounds` comes back null → `span`/`range` become null → timeline/tray unmount and the map must clear — which requires Step 4's MapView fix.

- [ ] **Step 3: Replace `web/src/components/FirstRun.tsx`**

```tsx
import { useState } from 'react'
import { addSource } from '../api'
import { useScanEvents } from '../hooks/useScanEvents'

export function FirstRun({ onConfigured }: { onConfigured: () => void }) {
  const [dir, setDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const { progress } = useScanEvents(onConfigured)

  const submit = async () => {
    setError(null)
    const res = await addSource(dir.trim())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'That folder could not be opened')
      return
    }
    setScanning(true)
  }

  return (
    <div className="first-run">
      <h1>yufu</h1>
      {!scanning ? (
        <>
          <p>Point me at your photo folder to build the map. You can add more folders later.</p>
          <input
            data-testid="folder-input"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="/Users/you/Pictures"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <button data-testid="folder-submit" onClick={() => void submit()}>
            Scan photos
          </button>
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <p>
          Scanning… {progress.done} / {progress.total || '…'}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: MapView — always re-init the worker on points change**

In `web/src/components/MapView.tsx`, find:
```tsx
  useEffect(() => {
    if (points.length > 0) clientRef.current?.init(points)
  }, [points])
```
and replace with:
```tsx
  // Init unconditionally: an emptied library (all sources disabled/removed)
  // must rebuild to an empty index so stale markers disappear.
  useEffect(() => {
    clientRef.current?.init(points)
  }, [points])
```

- [ ] **Step 5: Verification deferred to Task 7**

The app does not compile until SettingsSheet's new props exist. Proceed directly to Task 7; the combined verification (`npm run build -w web`, `npm test -w web`, `npm test -w server`) happens there. Stage this task's files but commit after the build is green:

```bash
git add web/src/api.ts web/src/App.tsx web/src/components/FirstRun.tsx web/src/components/MapView.tsx
git commit -m "feat: frontend sources model, first-run via sources, empty-library marker clearing"
```
(Commit AFTER Task 7 Step 3's build verification passes — two commits, one verification.)

---

### Task 7: SettingsSheet source manager + styles

**Files:**
- Modify: `web/src/components/SettingsSheet.tsx` (replace entire file), `web/src/styles.css` (append)

**Interfaces:**
- Consumes: `Source`, `addSource`, `patchSource`, `deleteSource`, `startScan` (Task 6); `useScanEvents` (existing).
- Produces: `SettingsSheet({ sources: Source[], onClose, onChanged })` — the props App (Task 6) already passes. Testids `source-list`, `add-source-input`, `add-source-submit` (e2e Task 8 may rely on them).

- [ ] **Step 1: Replace `web/src/components/SettingsSheet.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { addSource, deleteSource, patchSource, startScan, type Source } from '../api'
import { useScanEvents } from '../hooks/useScanEvents'

export interface SettingsSheetProps {
  sources: Source[]
  onClose: () => void
  onChanged: () => void
}

export function SettingsSheet({ sources, onClose, onChanged }: SettingsSheetProps) {
  const [newPath, setNewPath] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)
  const { running, progress } = useScanEvents(onChanged)
  const [skipped, setSkipped] = useState<number>(0)

  useEffect(() => {
    void fetch('/api/scan/status')
      .then((r) => r.json())
      .then((s) => setSkipped(s.lastResult?.skippedUnreadable ?? 0))
      .catch(() => {})
  }, [running])

  const add = async () => {
    setStatus(null)
    const res = await addSource(newPath.trim())
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setStatus(body?.error ?? 'Could not add that folder')
      return
    }
    setNewPath('')
    setStatus('Folder added — scanning…')
    onChanged()
  }

  const toggle = async (s: Source) => {
    await patchSource(s.id, !s.enabled)
    onChanged()
  }

  const remove = async (id: number) => {
    setConfirmRemove(null)
    await deleteSource(id)
    setStatus('Folder removed')
    onChanged()
  }

  const rescan = async () => {
    await startScan()
    setStatus('Rescanning…')
  }

  return (
    <div className="sheet panel">
      <header>
        <span>Settings</span>
        <button onClick={onClose}>✕</button>
      </header>
      <label>Photo folders</label>
      <ul className="source-list" data-testid="source-list">
        {sources.map((s) => (
          <li key={s.id} className={s.enabled ? 'source-row' : 'source-row source-disabled'}>
            <button
              className="source-eye"
              title={s.enabled ? 'Hide this folder' : 'Show this folder'}
              onClick={() => void toggle(s)}
            >
              {s.enabled ? '●' : '○'}
            </button>
            <span className="source-path" title={s.path}>
              {s.path.split('/').pop() || s.path}
            </span>
            {!s.exists && <span className="source-missing" title="Folder not reachable">!</span>}
            <span className="source-count">{s.photoCount}</span>
            {confirmRemove === s.id ? (
              <button className="source-remove danger" onClick={() => void remove(s.id)}>
                Remove?
              </button>
            ) : (
              <button className="source-remove" title="Remove folder" onClick={() => setConfirmRemove(s.id)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          data-testid="add-source-input"
          value={newPath}
          placeholder="/Users/you/Pictures"
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button data-testid="add-source-submit" onClick={() => void add()}>
          Add
        </button>
      </div>
      <div className="row">
        <button onClick={() => void rescan()}>Rescan all</button>
      </div>
      {running && (
        <p>
          Scanning… {progress.done} / {progress.total || '…'}
        </p>
      )}
      {status && <p>{status}</p>}
      {skipped > 0 && <p>{skipped} unreadable file{skipped === 1 ? '' : 's'} skipped in the last scan</p>}
    </div>
  )
}
```

- [ ] **Step 2: Append styles**

Append to `web/src/styles.css`:
```css
.source-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 40vh;
  overflow-y: auto;
}
.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.08);
}
.source-row.source-disabled .source-path,
.source-row.source-disabled .source-count {
  opacity: 0.45;
}
.source-eye {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 14px;
  cursor: pointer;
  width: 24px;
}
.source-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-missing {
  color: #ff453a;
  font-weight: 700;
}
.source-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  font-size: 13px;
}
.source-remove {
  border: none;
  background: none;
  color: var(--panel-fg);
  opacity: 0.6;
  cursor: pointer;
}
.source-remove.danger {
  background: #b3261e;
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  opacity: 1;
}
```

- [ ] **Step 3: Verify Tasks 6+7 together**

Run: `npm run build -w web` (tsc + vite must pass), `npm test -w web`, `npm test -w server`
Expected: all green. Do NOT run e2e yet (rewritten in Task 8).

- [ ] **Step 4: Commit both tasks (two commits)**

```bash
git add web/src/api.ts web/src/App.tsx web/src/components/FirstRun.tsx web/src/components/MapView.tsx
git commit -m "feat: frontend sources model, first-run via sources, empty-library marker clearing"
git add web/src/components/SettingsSheet.tsx web/src/styles.css
git commit -m "feat: settings sheet becomes a multi-folder source manager"
```

---

### Task 8: E2E updates, multi-source test, README

**Files:**
- Modify: `e2e/photo-map.spec.ts` (two edits below), `README.md` (one paragraph)

**Interfaces:**
- Consumes: POST/PATCH/DELETE /api/sources (Task 5); `.photo-marker` and existing testids.

- [ ] **Step 1: Update the e2e seeding**

In `e2e/photo-map.spec.ts`, replace:
```ts
  const res = await request.put('/api/config', { data: { photoDir } })
  expect(res.ok()).toBeTruthy()
```
with:
```ts
  const res = await request.post('/api/sources', { data: { path: photoDir } })
  expect(res.status()).toBe(201)
```

- [ ] **Step 2: Append the multi-source test**

Also change the file's `node:fs` import line to `import { mkdirSync, mkdtempSync } from 'node:fs'` (the new test uses `mkdirSync`).

Append at the END of `e2e/photo-map.spec.ts` (test order matters — this test mutates and then restores the source set):
```ts
test('sources can be added, hidden, and removed', async ({ page, request }) => {
  const tokyoDir = mkdtempSync(join(tmpdir(), 'yufu-e2e-tokyo-'))
  for (let i = 0; i < 2; i++)
    await makeJpeg(join(tokyoDir, `tokyo${i}.jpg`), {
      lat: 35.68 + i * 0.001, lon: 139.76 + i * 0.001, takenAt: `2025:03:0${i + 1} 10:00:00`,
    })

  const created = await request.post('/api/sources', { data: { path: tokyoDir } })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await expect
    .poll(async () => !(await (await request.get('/api/scan/status')).json()).running, { timeout: 30_000 })
    .toBe(true)

  // Nested folders are rejected (create the subfolder so the check reaches
  // the nesting rule rather than the not-a-directory 400).
  mkdirSync(join(tokyoDir, 'sub'))
  const nested = await request.post('/api/sources', { data: { path: join(tokyoDir, 'sub') } })
  expect(nested.status()).toBe(409)

  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(3, { timeout: 15_000 }) // Istanbul + NYC + Tokyo

  const hidden = await request.patch(`/api/sources/${id}`, { data: { enabled: false } })
  expect(hidden.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })

  const removed = await request.delete(`/api/sources/${id}`)
  expect(removed.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('.photo-marker')).toHaveCount(2, { timeout: 15_000 })
})
```

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run e2e`
Expected: all 5 tests PASS. If a marker count fails, debug the root cause (server logs, /api/sources via curl) — do not weaken assertions.

- [ ] **Step 4: Update README**

In `README.md`, replace the sentence:
```
On first launch, enter the path to your photo folder. The initial scan of a
large library takes a few minutes; rescans are incremental and fast.
```
with:
```
On first launch, enter the path to your photo folder — you can add more
folders later in settings (⚙), where each folder can also be hidden or
removed independently. The initial scan of a large library takes a few
minutes; rescans are incremental and fast.
```

- [ ] **Step 5: Full verification and commit**

Run: `npm test && npm run e2e`
Expected: everything green.

```bash
git add e2e/photo-map.spec.ts README.md
git commit -m "test: e2e coverage for multi-source add/hide/remove; README update"
```
