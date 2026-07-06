import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { getThumbPath, THUMB_SIZES } from '../src/thumbs.js'
import { makeJpeg } from './helpers/fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'galleria-thumb-'))
const cache = join(dir, 'cache')

it('exposes the allowed sizes', () => {
  expect([...THUMB_SIZES].sort((a, b) => a - b)).toEqual([96, 256, 2048])
})

it('generates a resized jpeg thumbnail', async () => {
  const src = join(dir, 'big.jpg')
  await makeJpeg(src, { width: 800, height: 600 })
  const out = await getThumbPath(cache, { id: 1, path: src, mtime: 100 }, 256)
  const meta = await sharp(out).metadata()
  expect(meta.format).toBe('jpeg')
  expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(256)
})

it('serves from cache on second call (file not regenerated)', async () => {
  const src = join(dir, 'cached.jpg')
  await makeJpeg(src, { width: 400, height: 300 })
  const out1 = await getThumbPath(cache, { id: 2, path: src, mtime: 100 }, 96)
  const mtime1 = statSync(out1).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  const out2 = await getThumbPath(cache, { id: 2, path: src, mtime: 100 }, 96)
  expect(out2).toBe(out1)
  expect(statSync(out2).mtimeMs).toBe(mtime1)
})

it('does not enlarge small photos', async () => {
  const src = join(dir, 'small.jpg')
  await makeJpeg(src, { width: 50, height: 40 })
  const out = await getThumbPath(cache, { id: 3, path: src, mtime: 100 }, 2048)
  const meta = await sharp(out).metadata()
  expect(meta.width).toBe(50)
})

it('throws for unreadable source', async () => {
  await expect(getThumbPath(cache, { id: 4, path: join(dir, 'missing.jpg'), mtime: 100 }, 96)).rejects.toThrow()
})

it('leaves no partial file at the final cache path after a failed generation', async () => {
  const missing = join(dir, 'missing2.jpg')
  const out = join(cache, '5_100_96.jpg')
  await expect(getThumbPath(cache, { id: 5, path: missing, mtime: 100 }, 96)).rejects.toThrow()
  expect(existsSync(out)).toBe(false)
})

it('rotates per EXIF orientation', async () => {
  const src = join(dir, 'rotated.jpg')
  await makeJpeg(src, { width: 100, height: 80, orientation: 6 })
  const out = await getThumbPath(cache, { id: 6, path: src, mtime: 100 }, 2048)
  const meta = await sharp(out).metadata()
  expect(meta.width).toBe(80)
  expect(meta.height).toBe(100)
  expect(meta.width!).toBeLessThan(meta.height!)
  expect(meta.orientation).toBeUndefined()
})

it('handles concurrent calls for the same (id, size) safely', async () => {
  const src = join(dir, 'concurrent.jpg')
  await makeJpeg(src, { width: 300, height: 200 })
  const results = await Promise.all(
    Array.from({ length: 5 }, () => getThumbPath(cache, { id: 7, path: src, mtime: 100 }, 256)),
  )
  const expected = join(cache, '7_100_256.jpg')
  for (const r of results) expect(r).toBe(expected)
  const meta = await sharp(expected).metadata()
  expect(meta.format).toBe('jpeg')
})

it('same id with a different mtime gets a fresh cache file (edited photo)', async () => {
  const src = join(dir, 'edited.jpg')
  await makeJpeg(src, { width: 400, height: 300 })
  const out1 = await getThumbPath(cache, { id: 8, path: src, mtime: 1000 }, 96)
  const out2 = await getThumbPath(cache, { id: 8, path: src, mtime: 2000 }, 96)
  expect(out2).not.toBe(out1)
  expect(existsSync(out1)).toBe(true)
  expect(existsSync(out2)).toBe(true)
})
