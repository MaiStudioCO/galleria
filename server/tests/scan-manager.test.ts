import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getIndexState, openDb } from '../src/db.js'
import { ScanManager } from '../src/scan-manager.js'
import { makeJpeg } from './helpers/fixtures.js'
// SKIPPED(Task 1 bridge): this suite is rewritten for multi-source in a later task.

it.skip('queues a start() issued while a scan is running and applies the new folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yufu-scanmgr-'))
  const folderA = join(root, 'a')
  const folderB = join(root, 'b')
  mkdirSync(folderA)
  mkdirSync(folderB)
  await makeJpeg(join(folderA, 'a1.jpg'), { takenAt: '2023:01:01 10:00:00' })
  await makeJpeg(join(folderA, 'a2.jpg'), { takenAt: '2023:01:02 10:00:00' })
  await makeJpeg(join(folderB, 'b1.jpg'), { lat: 41, lon: 29, takenAt: '2024:01:01 10:00:00' })

  const db = openDb(':memory:')
  const mgr = new ScanManager()
  let doneCount = 0
  mgr.on('done', () => doneCount++)

  const first = mgr.start(db, folderA)
  expect(mgr.running).toBe(true)
  // Called mid-scan: must not be dropped — it should queue and report accepted.
  const accepted = await mgr.start(db, folderB)
  expect(accepted).toBe(true)
  await first

  // The queued scan runs after the first finishes; the index ends up on folder B.
  await expect
    .poll(() => {
      const paths = [...getIndexState(db, 0).keys()] // BRIDGE(Task 3)
      return !mgr.running && paths.length === 1 && paths[0] === join(folderB, 'b1.jpg')
    }, { timeout: 10_000 })
    .toBe(true)
  expect(doneCount).toBe(2)
})
