import exifr from 'exifr'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { makeJpeg } from './helpers/fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'yufu-fix-'))

it('writes GPS and date EXIF that exifr can read back', async () => {
  const p = join(dir, 'a.jpg')
  await makeJpeg(p, { lat: 41.0082, lon: 28.9784, takenAt: '2023:05:01 12:00:00' })
  const exif = await exifr.parse(p)
  expect(exif.latitude).toBeCloseTo(41.0082, 3)
  expect(exif.longitude).toBeCloseTo(28.9784, 3)
  expect(exif.DateTimeOriginal).toBeInstanceOf(Date)
  expect(exif.DateTimeOriginal.getFullYear()).toBe(2023)
})

it('writes a plain JPEG when no options given', async () => {
  const p = join(dir, 'plain.jpg')
  await makeJpeg(p)
  const exif = await exifr.parse(p).catch(() => undefined)
  expect(exif?.latitude).toBeUndefined()
})

it('supports southern/western hemispheres', async () => {
  const p = join(dir, 'sw.jpg')
  await makeJpeg(p, { lat: -33.8688, lon: -70.6693 })
  const exif = await exifr.parse(p)
  expect(exif.latitude).toBeCloseTo(-33.8688, 3)
  expect(exif.longitude).toBeCloseTo(-70.6693, 3)
})
