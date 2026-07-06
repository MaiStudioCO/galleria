import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

it('GET /health returns ok', async () => {
  const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'galleria-test-')) })
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
})
