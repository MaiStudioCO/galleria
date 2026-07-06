import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import open from 'open'
import { buildApp } from './app.js'

const dataDir = process.env.GALLERIA_DATA_DIR
  ? resolve(process.env.GALLERIA_DATA_DIR)
  : join(homedir(), '.galleria')
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const port = Number(process.env.PORT ?? 3000)

const app = await buildApp({ dataDir, webDist })
await app.listen({ host: '127.0.0.1', port })
const url = `http://127.0.0.1:${port}`
console.log(`galleria running at ${url} (data: ${dataDir})`)
if (!process.env.GALLERIA_NO_OPEN) await open(url)
