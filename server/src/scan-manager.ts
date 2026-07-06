import { EventEmitter } from 'node:events'
import type { Db } from './db.js'
import { scanFolder, type ScanResult } from './scanner.js'

export class ScanManager extends EventEmitter {
  running = false
  progress = { done: 0, total: 0 }
  lastResult: ScanResult | null = null
  private queued: { db: Db; folder: string } | null = null

  async start(db: Db, folder: string): Promise<boolean> {
    if (this.running) {
      // Don't drop a folder change made mid-scan: queue it (latest wins) and
      // run it as soon as the current scan finishes.
      this.queued = { db, folder }
      return true
    }
    this.running = true
    this.progress = { done: 0, total: 0 }
    try {
      const result = await scanFolder(db, 0, folder, (done, total) => {
        // BRIDGE(Task 4)
        this.progress = { done, total }
        this.emit('progress', this.progress)
      })
      this.lastResult = result
      this.emit('done', result)
      return true
    } catch (err) {
      this.emit('failed', { message: (err as Error).message })
      return false
    } finally {
      this.running = false
      const next = this.queued
      if (next) {
        this.queued = null
        void this.start(next.db, next.folder)
      }
    }
  }
}
