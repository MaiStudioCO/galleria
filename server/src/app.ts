import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig, saveConfig } from './config.js'
import { getPhoto, getPoints, getUnlocated, openDb } from './db.js'
import { ScanManager } from './scan-manager.js'
import { getThumbPath, THUMB_SIZES } from './thumbs.js'

export interface AppContext {
  dataDir: string
  webDist?: string
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  mkdirSync(ctx.dataDir, { recursive: true })
  const db = openDb(join(ctx.dataDir, 'index.db'))
  const scanManager = new ScanManager()
  const app = Fastify()

  app.get('/health', async () => ({ ok: true }))

  app.get('/api/photos', async () => getPoints(db))

  app.get('/api/photos/unlocated', async (req) => {
    const q = req.query as Record<string, string | undefined>
    return getUnlocated(db, {
      from: q.from !== undefined ? Number(q.from) : undefined,
      to: q.to !== undefined ? Number(q.to) : undefined,
      page: q.page !== undefined ? Number(q.page) : 0,
    })
  })

  app.get('/api/photos/:id', async (req, reply) => {
    const photo = getPhoto(db, Number((req.params as { id: string }).id))
    if (!photo) return reply.code(404).send({ error: 'not found' })
    return photo
  })

  app.get('/thumb/:id', async (req, reply) => {
    const size = Number((req.query as { size?: string }).size ?? 256)
    if (!THUMB_SIZES.has(size)) return reply.code(400).send({ error: 'invalid size' })
    const photo = getPhoto(db, Number((req.params as { id: string }).id))
    if (!photo) return reply.code(404).send({ error: 'not found' })
    try {
      const p = await getThumbPath(join(ctx.dataDir, 'thumbs'), photo, size)
      return reply.type('image/jpeg').send(createReadStream(p))
    } catch {
      return reply.code(404).send({ error: 'unreadable source photo' })
    }
  })

  app.get('/api/config', async () => loadConfig(ctx.dataDir))

  app.put('/api/config', async (req, reply) => {
    const body = req.body as { photoDir?: unknown }
    if (typeof body?.photoDir !== 'string') return reply.code(400).send({ error: 'photoDir required' })
    const st = await stat(body.photoDir).catch(() => null)
    if (!st?.isDirectory()) return reply.code(400).send({ error: 'not a directory' })
    saveConfig(ctx.dataDir, { photoDir: body.photoDir })
    void scanManager.start(db, body.photoDir)
    return { photoDir: body.photoDir }
  })

  app.post('/api/scan', async (_req, reply) => {
    const { photoDir } = loadConfig(ctx.dataDir)
    if (!photoDir) return reply.code(400).send({ error: 'no folder configured' })
    if (scanManager.running) return reply.code(409).send({ error: 'scan in progress' })
    void scanManager.start(db, photoDir)
    return reply.code(202).send({ started: true })
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
