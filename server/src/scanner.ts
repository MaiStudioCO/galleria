import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { deleteByPaths, getIndexState, upsertPhoto, type Db } from './db.js'
import { extractPhotoRecord } from './exif.js'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const CONCURRENCY = 8

export interface ScanResult {
  scanned: number
  added: number
  updated: number
  removed: number
  skippedUnreadable: number
}

export type ProgressFn = (done: number, total: number) => void

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        await fn(items[idx])
      }
    }),
  )
}

export async function scanFolder(db: Db, folder: string, onProgress?: ProgressFn): Promise<ScanResult> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((e) => e.isFile() && EXTENSIONS.has(extname(e.name).toLowerCase()))
    .map((e) => join(e.parentPath, e.name))
  const known = getIndexState(db, 0) // BRIDGE(Task 3): scanner becomes source-scoped in Task 3
  const result: ScanResult = { scanned: files.length, added: 0, updated: 0, removed: 0, skippedUnreadable: 0 }
  const seen = new Set<string>()
  let done = 0

  await mapPool(files, CONCURRENCY, async (file) => {
    seen.add(file)
    const prev = known.get(file)
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(file)
    } catch {
      result.skippedUnreadable++
      done++
      onProgress?.(done, files.length)
      return
    }
    if (prev && prev.mtime === Math.round(st.mtimeMs) && prev.size === st.size) {
      done++
      onProgress?.(done, files.length)
      return
    }
    const record = await extractPhotoRecord(file)
    if (record === null) result.skippedUnreadable++
    else {
      upsertPhoto(db, record, 0) // BRIDGE(Task 3)
      if (prev) result.updated++
      else result.added++
    }
    done++
    onProgress?.(done, files.length)
  })

  const removedPaths = [...known.keys()].filter((p) => !seen.has(p))
  deleteByPaths(db, removedPaths)
  result.removed = removedPaths.length
  return result
}
