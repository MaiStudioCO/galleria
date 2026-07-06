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
