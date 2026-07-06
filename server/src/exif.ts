import exifr from 'exifr'
import { stat } from 'node:fs/promises'
import sharp from 'sharp'

export interface PhotoRecord {
  path: string
  lat: number | null
  lon: number | null
  takenAt: number
  width: number
  height: number
  mtime: number
  size: number
}

export function isValidGps(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  if (lat === 0 && lon === 0) return false
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

export async function extractPhotoRecord(path: string): Promise<PhotoRecord | null> {
  try {
    const st = await stat(path)
    const meta = await sharp(path).metadata()
    let exif: Record<string, unknown> | undefined
    try {
      exif = await exifr.parse(path)
    } catch {
      exif = undefined
    }
    const hasGps = exif !== undefined && isValidGps(exif.latitude, exif.longitude)
    const taken =
      exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : st.mtimeMs
    return {
      path,
      lat: hasGps ? (exif!.latitude as number) : null,
      lon: hasGps ? (exif!.longitude as number) : null,
      takenAt: Math.round(taken),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      mtime: Math.round(st.mtimeMs),
      size: st.size,
    }
  } catch {
    return null
  }
}
