import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import open from 'open'
import { buildApp } from './app.js'
import { startOrAttach } from './serve.js'

const dataDir = process.env.GALLERIA_DATA_DIR
  ? resolve(process.env.GALLERIA_DATA_DIR)
  : join(homedir(), '.galleria')
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const host = '127.0.0.1'
const port = Number(process.env.PORT ?? 3000)
const url = `http://${host}:${port}`

const app = await buildApp({ dataDir, webDist })
const openBrowser = process.env.GALLERIA_NO_OPEN ? async () => {} : (u: string) => open(u)
const result = await startOrAttach({ app, host, port, openBrowser })

if (result === 'started') {
  console.log(`galleria running at ${url} (data: ${dataDir})`)
  const stop = () => void app.close().then(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else {
  console.log(`galleria is already running — opened ${url} in your browser`)
}
