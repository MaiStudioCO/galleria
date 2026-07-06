import { EventEmitter } from 'node:events'
import { listSources, type Db, type SourceRow } from './db.js'
import { listPhotoFiles, scanFolder, type ScanResult } from './scanner.js'

export interface SourceScanOutcome {
  sourceId: number
  path: string
  result?: ScanResult
  error?: string
}

export interface ScanAllResult extends ScanResult {
  perSource: SourceScanOutcome[]
}

export class ScanManager extends EventEmitter {
  running = false
  progress = { done: 0, total: 0 }
  lastResult: ScanAllResult | null = null
  private queued: { db: Db } | null = null

  /**
   * Scan every enabled source (or a single one, for a source that was just
   * added). Requests during a running scan queue one follow-up scan-all.
   */
  async start(db: Db, onlySourceId?: number): Promise<boolean> {
    if (this.running) {
      this.queued = { db }
      return true
    }
    this.running = true
    this.progress = { done: 0, total: 0 }
    try {
      let sources = listSources(db).filter((s) => s.enabled)
      if (onlySourceId !== undefined) sources = sources.filter((s) => s.id === onlySourceId)

      const perSource: SourceScanOutcome[] = []
      // List every source first so the progress total is global.
      const listed: { source: SourceRow; files: string[] }[] = []
      for (const source of sources) {
        try {
          listed.push({ source, files: await listPhotoFiles(source.path) })
        } catch (err) {
          perSource.push({ sourceId: source.id, path: source.path, error: (err as Error).message })
        }
      }
      const total = listed.reduce((n, l) => n + l.files.length, 0)
      const totals: ScanAllResult = { scanned: 0, added: 0, updated: 0, removed: 0, skippedUnreadable: 0, perSource }

      let offset = 0
      for (const { source, files } of listed) {
        const result = await scanFolder(
          db,
          source.id,
          source.path,
          (done) => {
            this.progress = { done: offset + done, total }
            this.emit('progress', this.progress)
          },
          files,
        )
        offset += files.length
        totals.scanned += result.scanned
        totals.added += result.added
        totals.updated += result.updated
        totals.removed += result.removed
        totals.skippedUnreadable += result.skippedUnreadable
        perSource.push({ sourceId: source.id, path: source.path, result })
      }

      this.progress = { done: total, total }
      this.lastResult = totals
      this.emit('done', totals)
      return true
    } catch (err) {
      this.emit('failed', { message: (err as Error).message })
      return false
    } finally {
      this.running = false
      const next = this.queued
      if (next) {
        this.queued = null
        void this.start(next.db)
      }
    }
  }
}
