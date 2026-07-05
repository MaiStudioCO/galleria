import Fastify, { type FastifyInstance } from 'fastify'
import { mkdirSync } from 'node:fs'

export interface AppContext {
  dataDir: string
  webDist?: string
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  mkdirSync(ctx.dataDir, { recursive: true })
  const app = Fastify()
  app.get('/health', async () => ({ ok: true }))
  return app
}
