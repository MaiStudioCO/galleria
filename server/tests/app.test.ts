import type { FastifyInstance } from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { makeJpeg } from './helpers/fixtures.js'

let app: FastifyInstance
let photoDir: string

async function waitForScan(a: FastifyInstance) {
  for (let i = 0; i < 200; i++) {
    const res = await a.inject({ method: 'GET', url: '/api/scan/status' })
    const s = res.json()
    if (!s.running && s.lastResult) return s.lastResult
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('scan did not finish')
}

beforeAll(async () => {
  photoDir = mkdtempSync(join(tmpdir(), 'yufu-api-photos-'))
  await makeJpeg(join(photoDir, 'geo.jpg'), { lat: 41, lon: 29, takenAt: '2023:05:01 10:00:00' })
  await makeJpeg(join(photoDir, 'geo2.jpg'), { lat: 48.8, lon: 2.3, takenAt: '2024:07:01 10:00:00' })
  await makeJpeg(join(photoDir, 'nogps.jpg'), { takenAt: '2024:01:01 10:00:00' })
  app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'yufu-api-data-')) })
})

it('PUT /api/config rejects a non-directory', async () => {
  const res = await app.inject({
    method: 'PUT', url: '/api/config', payload: { photoDir: '/definitely/not/a/dir' },
  })
  expect(res.statusCode).toBe(400)
})

it('PUT /api/config saves folder and triggers a scan', async () => {
  const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { photoDir } })
  expect(res.statusCode).toBe(200)
  const result = await waitForScan(app)
  expect(result.added).toBe(3)
  const cfg = await app.inject({ method: 'GET', url: '/api/config' })
  expect(cfg.json()).toEqual({ photoDir })
})

it('GET /api/photos returns geolocated points', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos' })
  const points = res.json()
  expect(points).toHaveLength(2)
  expect(points[0]).toHaveProperty('takenAt')
})

it('GET /api/photos/unlocated filters by range', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated' })
  expect(res.json().total).toBe(1)
  const none = await app.inject({ method: 'GET', url: '/api/photos/unlocated?from=0&to=1000' })
  expect(none.json().total).toBe(0)
})

it('GET /api/photos/:id returns detail or 404', async () => {
  const points = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  const res = await app.inject({ method: 'GET', url: `/api/photos/${points[0].id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toHaveProperty('path')
  expect((await app.inject({ method: 'GET', url: '/api/photos/99999' })).statusCode).toBe(404)
})

it('GET /thumb/:id serves a jpeg and validates size', async () => {
  const points = (await app.inject({ method: 'GET', url: '/api/photos' })).json()
  const ok = await app.inject({ method: 'GET', url: `/thumb/${points[0].id}?size=96` })
  expect(ok.statusCode).toBe(200)
  expect(ok.headers['content-type']).toContain('image/jpeg')
  const bad = await app.inject({ method: 'GET', url: `/thumb/${points[0].id}?size=123` })
  expect(bad.statusCode).toBe(400)
  const missing = await app.inject({ method: 'GET', url: '/thumb/99999?size=96' })
  expect(missing.statusCode).toBe(404)
})

it('POST /api/scan re-runs and reports via status', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan' })
  expect(res.statusCode).toBe(202)
  const result = await waitForScan(app)
  expect(result.scanned).toBe(3)
})

it('GET /api/photos/unlocated rejects non-numeric from', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?from=abc' })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid query parameter' })
})

it('GET /api/photos/unlocated rejects negative page', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?page=-1' })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid query parameter' })
})

it('GET /api/photos/:id returns 404 for non-numeric id', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/abc' })
  expect(res.statusCode).toBe(404)
})

it('GET /thumb/:id returns 404 for non-numeric id', async () => {
  const res = await app.inject({ method: 'GET', url: '/thumb/abc?size=96' })
  expect(res.statusCode).toBe(404)
})
