import type { FastifyInstance } from 'fastify'

export interface ServeOptions {
  app: FastifyInstance
  host: string
  port: number
  /** Opens the given URL in the user's browser; inject a no-op to suppress. */
  openBrowser: (url: string) => Promise<unknown>
}

export type ServeResult = 'started' | 'attached'

/**
 * Bind the app to host:port and open the browser.
 *
 * If the port is already held by a *running galleria instance* (confirmed via
 * its /health endpoint), open the browser to that instance and return
 * 'attached' instead of crashing on EADDRINUSE — so launching galleria a second
 * time just focuses the one that's already running. If the port is held by
 * something else, throw a clear error rather than opening a stranger's page.
 */
export async function startOrAttach({ app, host, port, openBrowser }: ServeOptions): Promise<ServeResult> {
  const url = `http://${host}:${port}`
  try {
    await app.listen({ host, port })
  } catch (err) {
    if ((err as { code?: string }).code !== 'EADDRINUSE') throw err
    if (!(await isGalleriaRunning(url))) {
      throw new Error(
        `Port ${port} is already in use by another program. ` +
          `Close it, or run galleria on a different port with PORT=<number>.`,
      )
    }
    await openBrowser(url)
    return 'attached'
  }
  await openBrowser(url)
  return 'started'
}

async function isGalleriaRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`)
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: unknown }
    return body?.ok === true
  } catch {
    return false
  }
}
