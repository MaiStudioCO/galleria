import { mkdtempSync } from 'node:fs'
import { utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { extractPhotoRecord, isValidGps } from '../src/exif.js'
import { makeJpeg } from './helpers/fixtures.js'

const dir = mkdtempSync(join(tmpdir(), 'galleria-exif-'))

describe('isValidGps', () => {
  it('accepts normal coordinates', () => expect(isValidGps(41.0, 28.9)).toBe(true))
  it('rejects null island', () => expect(isValidGps(0, 0)).toBe(false))
  it('rejects out-of-range', () => {
    expect(isValidGps(91, 0)).toBe(false)
    expect(isValidGps(0, 181)).toBe(false)
  })
  it('rejects non-numbers', () => expect(isValidGps(undefined, 28.9)).toBe(false))
})

describe('extractPhotoRecord', () => {
  it('extracts GPS, date, and dimensions', async () => {
    const p = join(dir, 'full.jpg')
    await makeJpeg(p, { lat: 41.0082, lon: 28.9784, takenAt: '2023:05:01 12:00:00', width: 100, height: 80 })
    const rec = await extractPhotoRecord(p)
    expect(rec).not.toBeNull()
    expect(rec!.lat).toBeCloseTo(41.0082, 3)
    expect(rec!.lon).toBeCloseTo(28.9784, 3)
    expect(new Date(rec!.takenAt).getFullYear()).toBe(2023)
    expect(rec!.width).toBe(100)
    expect(rec!.height).toBe(80)
    expect(rec!.size).toBeGreaterThan(0)
  })

  it('falls back to file mtime when no EXIF date', async () => {
    const p = join(dir, 'nodate.jpg')
    await makeJpeg(p)
    const mtime = new Date('2020-06-15T00:00:00Z')
    await utimes(p, mtime, mtime)
    const rec = await extractPhotoRecord(p)
    expect(rec!.takenAt).toBe(mtime.getTime())
  })

  it('returns null lat/lon when GPS missing', async () => {
    const p = join(dir, 'nogps.jpg')
    await makeJpeg(p, { takenAt: '2022:01:01 00:00:00' })
    const rec = await extractPhotoRecord(p)
    expect(rec!.lat).toBeNull()
    expect(rec!.lon).toBeNull()
  })

  it('handles PNG (no EXIF) with dimensions and mtime date', async () => {
    const p = join(dir, 'img.png')
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#333' } }).png().toFile(p)
    const rec = await extractPhotoRecord(p)
    expect(rec!.lat).toBeNull()
    expect(rec!.width).toBe(40)
    expect(rec!.takenAt).toBeGreaterThan(0)
  })

  it('returns null for an unreadable file', async () => {
    const p = join(dir, 'corrupt.jpg')
    await writeFile(p, 'this is not a jpeg')
    expect(await extractPhotoRecord(p)).toBeNull()
  })
})
