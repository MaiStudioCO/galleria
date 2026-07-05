import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { openDb } from '../src/db.js'
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

beforeEach(async () => {
  db = openDb(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'yufu-scan-stat-'))
  await makeJpeg(join(dir, 'a.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(dir, 'b.jpg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(dir, 'vanishes.jpg'), { takenAt: '2024:01:01 10:00:00' })
})

it('survives a file disappearing between readdir and stat', async () => {
  const calls: [number, number][] = []
  const r = await scanFolder(db, dir, (done, total) => calls.push([done, total]))
  expect(r.skippedUnreadable).toBe(1)
  expect(r.added).toBe(2)
  expect(calls.at(-1)).toEqual([3, 3])
})
