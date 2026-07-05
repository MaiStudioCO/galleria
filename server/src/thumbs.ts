import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
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
  const tmp = join(cacheDir, `${photo.id}_${size}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await sharp(photo.path)
      .rotate()
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(tmp)
    await rename(tmp, out)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
  return out
}
