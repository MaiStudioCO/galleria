import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

export const THUMB_SIZES = new Set([96, 256, 2048])

export async function getThumbPath(
  cacheDir: string,
  photo: { id: number; path: string },
  size: number,
): Promise<string> {
  const out = join(cacheDir, `${photo.id}_${size}.jpg`)
  if (existsSync(out)) return out
  await mkdir(cacheDir, { recursive: true })
  await sharp(photo.path)
    .rotate()
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(out)
  return out
}
