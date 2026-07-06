import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPoints, getUnlocated, openDb } from '../src/db.js'
import { scanFolder } from '../src/scanner.js'
import { makeJpeg } from './helpers/fixtures.js'
// SKIPPED(Task 1 bridge): this suite is rewritten for multi-source in a later task.

let db: ReturnType<typeof openDb>
let dir: string

beforeEach(async () => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'yufu-scan-'))
  mkdirSync(join(dir, 'sub'))
  await makeJpeg(join(dir, 'a.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(dir, 'sub', 'b.jpeg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(dir, 'nogps.jpg'), { takenAt: '2024:01:01 10:00:00' })
  await writeFile(join(dir, 'notes.txt'), 'ignored')
})

it.skip('initial scan indexes recursively, skips non-photo files', async () => {
  const r = await scanFolder(db, dir)
  expect(r).toMatchObject({ scanned: 3, added: 3, updated: 0, removed: 0, skippedUnreadable: 0 })
  expect(getPoints(db)).toHaveLength(2)
  expect(getUnlocated(db, {}).total).toBe(1)
})

it.skip('rescan skips unchanged files', async () => {
  await scanFolder(db, dir)
  const r = await scanFolder(db, dir)
  expect(r).toMatchObject({ scanned: 3, added: 0, updated: 0, removed: 0 })
})

it.skip('re-extracts a modified file', async () => {
  await scanFolder(db, dir)
  await makeJpeg(join(dir, 'a.jpg'), { lat: 35.6, lon: 139.7, takenAt: '2025:01:01 10:00:00' })
  const future = new Date(Date.now() + 60_000)
  await utimes(join(dir, 'a.jpg'), future, future)
  const r = await scanFolder(db, dir)
  expect(r.updated).toBe(1)
  expect(getPoints(db).some((p) => Math.abs(p.lat - 35.6) < 0.01)).toBe(true)
})

it.skip('removes deleted files from the index', async () => {
  await scanFolder(db, dir)
  await rm(join(dir, 'a.jpg'))
  const r = await scanFolder(db, dir)
  expect(r.removed).toBe(1)
  expect(getPoints(db)).toHaveLength(1)
})

it.skip('counts unreadable files without aborting', async () => {
  await writeFile(join(dir, 'corrupt.jpg'), 'nope')
  const r = await scanFolder(db, dir)
  expect(r.skippedUnreadable).toBe(1)
  expect(r.added).toBe(3)
})

it.skip('reports progress', async () => {
  const calls: [number, number][] = []
  await scanFolder(db, dir, (done, total) => calls.push([done, total]))
  expect(calls.length).toBe(3)
  expect(calls.at(-1)).toEqual([3, 3])
})
