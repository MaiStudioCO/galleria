import { writeFile } from 'node:fs/promises'
import piexif from 'piexifjs'
import sharp from 'sharp'

export interface FixtureOpts {
  lat?: number
  lon?: number
  /** EXIF datetime string, e.g. '2023:05:01 12:00:00' */
  takenAt?: string
  width?: number
  height?: number
  /** EXIF orientation tag (1-8), e.g. 6 = rotate 90 CW */
  orientation?: number
}

export async function makeJpeg(outPath: string, opts: FixtureOpts = {}): Promise<void> {
  const { width = 64, height = 48 } = opts
  const base = await sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer()

  const exifObj: Record<string, Record<number, unknown>> = { '0th': {}, Exif: {}, GPS: {} }
  if (opts.takenAt) exifObj.Exif[piexif.ExifIFD.DateTimeOriginal] = opts.takenAt
  if (opts.orientation !== undefined) exifObj['0th'][piexif.ImageIFD.Orientation] = opts.orientation
  if (opts.lat !== undefined && opts.lon !== undefined) {
    exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = opts.lat >= 0 ? 'N' : 'S'
    exifObj.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(opts.lat))
    exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = opts.lon >= 0 ? 'E' : 'W'
    exifObj.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(opts.lon))
  }
  const withExif = piexif.insert(piexif.dump(exifObj), base.toString('binary'))
  await writeFile(outPath, Buffer.from(withExif, 'binary'))
}
