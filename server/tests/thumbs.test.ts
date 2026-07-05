import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { getThumbPath, THUMB_SIZES } from '../src/thumbs.js'
import { makeJpeg } from './helpers/fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'yufu-thumb-'))
const cache = join(dir, 'cache')

it('exposes the allowed sizes', () => {
  expect([...THUMB_SIZES].sort((a, b) => a - b)).toEqual([96, 256, 2048])
})

it('generates a resized jpeg thumbnail', async () => {
  const src = join(dir, 'big.jpg')
  await makeJpeg(src, { width: 800, height: 600 })
  const out = await getThumbPath(cache, { id: 1, path: src }, 256)
  const meta = await sharp(out).metadata()
  expect(meta.format).toBe('jpeg')
  expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(256)
})

it('serves from cache on second call (file not regenerated)', async () => {
  const src = join(dir, 'cached.jpg')
  await makeJpeg(src, { width: 400, height: 300 })
  const out1 = await getThumbPath(cache, { id: 2, path: src }, 96)
  const mtime1 = statSync(out1).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  const out2 = await getThumbPath(cache, { id: 2, path: src }, 96)
  expect(out2).toBe(out1)
  expect(statSync(out2).mtimeMs).toBe(mtime1)
})

it('does not enlarge small photos', async () => {
  const src = join(dir, 'small.jpg')
  await makeJpeg(src, { width: 50, height: 40 })
  const out = await getThumbPath(cache, { id: 3, path: src }, 2048)
  const meta = await sharp(out).metadata()
  expect(meta.width).toBe(50)
})

it('throws for unreadable source', async () => {
  await expect(getThumbPath(cache, { id: 4, path: join(dir, 'missing.jpg') }, 96)).rejects.toThrow()
})
