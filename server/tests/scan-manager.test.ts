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
