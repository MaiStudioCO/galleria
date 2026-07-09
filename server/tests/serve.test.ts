import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { startOrAttach } from '../src/serve.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'galleria-serve-'))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

it('starts a fresh server on a free port and opens the browser', async () => {
  const port = await freePort()
  const app = await buildApp({ dataDir: tmp() })
  const opened: string[] = []
  const result = await startOrAttach({ app, host: '127.0.0.1', port, openBrowser: async (u) => { opened.push(u) } })
  expect(result).toBe('started')
  expect(opened).toEqual([`http://127.0.0.1:${port}`])
  await app.close()
})

it('attaches to an already-running galleria instance instead of crashing', async () => {
  const first = await buildApp({ dataDir: tmp() })
  await first.listen({ host: '127.0.0.1', port: 0 })
  const port = (first.server.address() as AddressInfo).port

  const second = await buildApp({ dataDir: tmp() })
  const opened: string[] = []
  const result = await startOrAttach({ app: second, host: '127.0.0.1', port, openBrowser: async (u) => { opened.push(u) } })
  expect(result).toBe('attached')
  expect(opened).toEqual([`http://127.0.0.1:${port}`])

  await second.close()
  await first.close()
})

it('refuses to attach when the port is held by something that is not galleria', async () => {
  const raw = createServer((_req, res) => { res.writeHead(404); res.end() })
  await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()))
  const port = (raw.address() as AddressInfo).port

  const app = await buildApp({ dataDir: tmp() })
  let opened = 0
  await expect(
    startOrAttach({ app, host: '127.0.0.1', port, openBrowser: async () => { opened++ } }),
  ).rejects.toThrow(/already in use/i)
  expect(opened).toBe(0)

  await app.close()
  await new Promise<void>((r) => raw.close(() => r()))
})
