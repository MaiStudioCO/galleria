import { EventEmitter } from 'node:events'
import type { Db } from './db.js'
import { scanFolder, type ScanResult } from './scanner.js'

export class ScanManager extends EventEmitter {
  running = false
  progress = { done: 0, total: 0 }
  lastResult: ScanResult | null = null

  async start(db: Db, folder: string): Promise<boolean> {
    if (this.running) return false
    this.running = true
    this.progress = { done: 0, total: 0 }
    try {
      const result = await scanFolder(db, folder, (done, total) => {
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
    }
  }
}
