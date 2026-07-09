import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import {
  addSource, adoptLegacyPhotoDir, getDateBounds, getPhoto, getPoints, getUnlocated,
  listSources, openDb, removeSource, setSourceEnabled,
} from './db.js'
import { realPick, type FolderPick } from './folder-picker.js'
import { ScanManager } from './scan-manager.js'
import { findNestingConflict } from './sources.js'
import { getThumbPath, THUMB_SIZES } from './thumbs.js'

export interface AppContext {
  dataDir: string
  webDist?: string
  /** Injectable for tests; defaults to the real OS dialog. */
  pickFolder?: () => Promise<FolderPick>
  /** Injectable for tests; defaults to closing the server and exiting the process. */
  onShutdown?: () => void | Promise<void>
}

function parseId(raw: string): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** True when a Host/Origin authority (e.g. "127.0.0.1:3000", "localhost", "[::1]:3000") is a loopback address. */
function isLoopbackHost(authority: string | undefined): boolean {
  if (!authority) return false
  const host = authority.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  mkdirSync(ctx.dataDir, { recursive: true })
  const db = openDb(join(ctx.dataDir, 'index.db'))

  // One-time adoption of the pre-multi-source config: photoDir becomes source 1.
  const legacy = loadConfig(ctx.dataDir)
  if (legacy.photoDir && listSources(db).length === 0) {
    adoptLegacyPhotoDir(db, legacy.photoDir)
    saveConfig(ctx.dataDir, { photoDir: null })
  }

  const scanManager = new ScanManager()
  const app = Fastify()
  // Always exit, even if app.close() rejects, so quitting deterministically frees the port.
  const onShutdown = ctx.onShutdown ?? (() => { void app.close().finally(() => process.exit(0)) })

  // Localhost-only guard: reject requests whose Host isn't loopback (defends DNS
  // rebinding), and state-changing requests whose Origin isn't loopback (defends a
  // foreign site POSTing to 127.0.0.1). Same-origin app calls, the Vite dev proxy,
  // curl, and the e2e client all pass; a website you visit cannot fire these routes.
  app.addHook('onRequest', async (req, reply) => {
    if (!isLoopbackHost(req.headers.host)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const origin = req.headers.origin
    if (origin !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
      let ok = false
      try {
        ok = isLoopbackHost(new URL(origin).host)
      } catch {
        ok = false
      }
      if (!ok) return reply.code(403).send({ error: 'forbidden' })
    }
  })

  app.get('/health', async () => ({ ok: true }))

  app.get('/api/sources', async () => {
    const sources = listSources(db)
    return Promise.all(
      sources.map(async (s) => {
        const st = await stat(s.path).catch(() => null)
        return { ...s, exists: st?.isDirectory() ?? false }
      }),
    )
  })

  app.post('/api/sources', async (req, reply) => {
    const body = req.body as { path?: unknown }
    if (typeof body?.path !== 'string' || body.path.trim() === '') {
      return reply.code(400).send({ error: 'path required' })
    }
    const path = resolve(body.path.trim())
    const st = await stat(path).catch(() => null)
    if (!st?.isDirectory()) return reply.code(400).send({ error: 'not a directory' })
    const conflict = findNestingConflict(listSources(db).map((s) => s.path), path)
    if (conflict) return reply.code(409).send({ error: `overlaps existing source ${conflict}` })
    let source
    try {
      source = addSource(db, path)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
        return reply.code(409).send({ error: `overlaps existing source ${path}` })
      }
      throw err
    }
    void scanManager.start(db, source.id)
    return reply.code(201).send({ ...source, exists: true })
  })

  app.post('/api/pick-folder', async (_req, reply) => {
    const pick = ctx.pickFolder ?? realPick
    const result = await pick()
    if (!result.supported) return reply.code(501).send({ error: 'folder picker not supported on this OS' })
    return { path: result.path }
  })

  app.patch('/api/sources/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    const body = req.body as { enabled?: unknown }
    if (typeof body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled boolean required' })
    if (id === null || !setSourceEnabled(db, id, body.enabled)) {
      return reply.code(404).send({ error: 'not found' })
    }
    return { id, enabled: body.enabled }
  })

  app.delete('/api/sources/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    if (id === null || !removeSource(db, id)) return reply.code(404).send({ error: 'not found' })
    return { removed: true }
  })

  app.get('/api/photos', async () => getPoints(db))

  app.get('/api/library', async () => ({ bounds: getDateBounds(db) }))

  app.get('/api/photos/unlocated', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const from = q.from !== undefined ? Number(q.from) : undefined
    const to = q.to !== undefined ? Number(q.to) : undefined
    const page = q.page !== undefined ? Number(q.page) : 0
    if (
      (from !== undefined && !Number.isFinite(from)) ||
      (to !== undefined && !Number.isFinite(to)) ||
      !Number.isInteger(page) || page < 0
    ) {
      return reply.code(400).send({ error: 'invalid query parameter' })
    }
    return getUnlocated(db, { from, to, page })
  })

  app.get('/api/photos/:id', async (req, reply) => {
    const id = parseId((req.params as { id: string }).id)
    const photo = id !== null ? getPhoto(db, id) : undefined
    if (!photo) return reply.code(404).send({ error: 'not found' })
    return photo
  })

  app.get('/thumb/:id', async (req, reply) => {
    const size = Number((req.query as { size?: string }).size ?? 256)
    if (!THUMB_SIZES.has(size)) return reply.code(400).send({ error: 'invalid size' })
    const id = parseId((req.params as { id: string }).id)
    const photo = id !== null ? getPhoto(db, id) : undefined
    if (!photo) return reply.code(404).send({ error: 'not found' })
    try {
      const p = await getThumbPath(join(ctx.dataDir, 'thumbs'), photo, size)
      return reply.type('image/jpeg').send(createReadStream(p))
    } catch {
      return reply.code(404).send({ error: 'unreadable source photo' })
    }
  })

  app.post('/api/scan', async (_req, reply) => {
    if (listSources(db).filter((s) => s.enabled).length === 0) {
      return reply.code(400).send({ error: 'no sources configured' })
    }
    if (scanManager.running) return reply.code(409).send({ error: 'scan in progress' })
    void scanManager.start(db)
    return reply.code(202).send({ started: true })
  })

  app.post('/api/shutdown', async () => {
    // Respond first, then shut down — the 50 ms delay lets the reply flush to the
    // browser before the process exits and the port is freed.
    setTimeout(() => { void onShutdown() }, 50)
    return { ok: true }
  })

  app.get('/api/scan/status', async () => ({
    running: scanManager.running,
    progress: scanManager.progress,
    lastResult: scanManager.lastResult,
  }))

  app.get('/api/scan/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    send('progress', scanManager.progress)
    const onProgress = (p: unknown) => send('progress', p)
    const onDone = (r: unknown) => send('done', r)
    const onFailed = (e: unknown) => send('failed', e)
    scanManager.on('progress', onProgress).on('done', onDone).on('failed', onFailed)
    req.raw.on('close', () => {
      scanManager.off('progress', onProgress).off('done', onDone).off('failed', onFailed)
    })
  })

  if (ctx.webDist && existsSync(ctx.webDist)) {
    await app.register(fastifyStatic, { root: ctx.webDist })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'not found' })
    })
  }

  return app
}
