import type { FastifyInstance } from 'fastify'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { loadConfig, saveConfig } from '../src/config.js'
import { makeJpeg } from './helpers/fixtures.js'

let app: FastifyInstance
let photoDir: string
let sourceId: number

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

it('starts with no sources', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/sources' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual([])
})

it('POST /api/sources rejects a non-directory', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: '/definitely/not/a/dir' } })
  expect(res.statusCode).toBe(400)
})

it('POST /api/sources adds a folder and triggers its scan', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: photoDir } })
  expect(res.statusCode).toBe(201)
  const source = res.json()
  sourceId = source.id
  expect(source).toMatchObject({ path: photoDir, enabled: true, exists: true })
  const result = await waitForScan(app)
  expect(result.added).toBe(3)
  const list = (await app.inject({ method: 'GET', url: '/api/sources' })).json()
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ id: sourceId, photoCount: 3, enabled: true, exists: true })
})

it('POST /api/sources rejects nested and duplicate paths with 409', async () => {
  const dup = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: photoDir } })
  expect(dup.statusCode).toBe(409)
  const nested = join(photoDir, 'sub')
  mkdirSync(nested)
  const child = await app.inject({ method: 'POST', url: '/api/sources', payload: { path: nested } })
  expect(child.statusCode).toBe(409)
  expect(child.json().error).toContain(photoDir)
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

it('PATCH /api/sources/:id toggles visibility and filters every photo query', async () => {
  const off = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: false } })
  expect(off.statusCode).toBe(200)
  expect(off.json()).toEqual({ id: sourceId, enabled: false })
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'GET', url: '/api/photos/unlocated' })).json().total).toBe(0)
  expect((await app.inject({ method: 'GET', url: '/api/library' })).json()).toEqual({ bounds: null })

  const on = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: true } })
  expect(on.statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(2)
})

it('PATCH validates body and id', async () => {
  const badBody = await app.inject({ method: 'PATCH', url: `/api/sources/${sourceId}`, payload: { enabled: 'yes' } })
  expect(badBody.statusCode).toBe(400)
  const badId = await app.inject({ method: 'PATCH', url: '/api/sources/999', payload: { enabled: true } })
  expect(badId.statusCode).toBe(404)
})

it('POST /api/scan rescans all enabled sources', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan' })
  expect(res.statusCode).toBe(202)
  const result = await waitForScan(app)
  expect(result.scanned).toBe(3)
  expect(result.perSource).toHaveLength(1)
})

it('config routes are gone', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/config' })).statusCode).toBe(404)
  expect((await app.inject({ method: 'PUT', url: '/api/config', payload: { photoDir } })).statusCode).toBe(404)
})

it('GET /api/sources reports exists=false for a vanished folder', async () => {
  const data = mkdtempSync(join(tmpdir(), 'yufu-api-orphan-'))
  const gone = join(data, 'gone')
  mkdirSync(gone)
  const a = await buildApp({ dataDir: data })
  await a.inject({ method: 'POST', url: '/api/sources', payload: { path: gone } })
  rmSync(gone, { recursive: true })
  const res = await a.inject({ method: 'GET', url: '/api/sources' })
  expect(res.json()[0]).toMatchObject({ exists: false })
})

it('adopts a legacy config.photoDir into a source at startup and clears it', async () => {
  const data = mkdtempSync(join(tmpdir(), 'yufu-api-legacy-'))
  const legacyDir = mkdtempSync(join(tmpdir(), 'yufu-api-legacy-photos-'))
  saveConfig(data, { photoDir: legacyDir })
  const a = await buildApp({ dataDir: data })
  const sources = (await a.inject({ method: 'GET', url: '/api/sources' })).json()
  expect(sources).toHaveLength(1)
  expect(sources[0]).toMatchObject({ path: legacyDir, enabled: true })
  expect(loadConfig(data)).toEqual({ photoDir: null })
  // Second boot on the same dataDir must not duplicate the source.
  const again = await buildApp({ dataDir: data })
  expect((await again.inject({ method: 'GET', url: '/api/sources' })).json()).toHaveLength(1)
})

it('DELETE /api/sources/:id removes the source and its photos', async () => {
  const del = await app.inject({ method: 'DELETE', url: `/api/sources/${sourceId}` })
  expect(del.statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/api/sources' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'GET', url: '/api/photos' })).json()).toHaveLength(0)
  expect((await app.inject({ method: 'DELETE', url: `/api/sources/${sourceId}` })).statusCode).toBe(404)
})

it('POST /api/scan without sources is a 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/scan' })
  expect(res.statusCode).toBe(400)
})

it('GET /api/photos/unlocated rejects non-numeric from', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?from=abc' })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'invalid query parameter' })
})

it('GET /api/photos/unlocated rejects negative page', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/photos/unlocated?page=-1' })
  expect(res.statusCode).toBe(400)
})

it('GET /api/photos/:id and /thumb/:id return 404 for non-numeric ids', async () => {
  expect((await app.inject({ method: 'GET', url: '/api/photos/abc' })).statusCode).toBe(404)
  expect((await app.inject({ method: 'GET', url: '/thumb/abc?size=96' })).statusCode).toBe(404)
})

it('GET /api/library returns date bounds spanning unlocated photos', async () => {
  const isolatedPhotoDir = mkdtempSync(join(tmpdir(), 'yufu-api-bounds-photos-'))
  await makeJpeg(join(isolatedPhotoDir, 'geo.jpg'), { lat: 41, lon: 29, takenAt: '2024:06:01 10:00:00' })
  await makeJpeg(join(isolatedPhotoDir, 'nogps.jpg'), { takenAt: '2020:01:01 10:00:00' })
  const isolatedApp = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'yufu-api-bounds-data-')) })
  await isolatedApp.inject({ method: 'POST', url: '/api/sources', payload: { path: isolatedPhotoDir } })
  await waitForScan(isolatedApp)
  const { bounds } = (await isolatedApp.inject({ method: 'GET', url: '/api/library' })).json()
  expect(bounds[0]).toBeLessThan(bounds[1])
  expect(new Date(bounds[0]).getUTCFullYear()).toBe(2020)
  expect(new Date(bounds[1]).getUTCFullYear()).toBe(2024)
})
