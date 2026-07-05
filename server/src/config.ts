import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Config {
  photoDir: string | null
}

export function loadConfig(dataDir: string): Config {
  const p = join(dataDir, 'config.json')
  if (!existsSync(p)) return { photoDir: null }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<Config>
    return { photoDir: typeof parsed.photoDir === 'string' ? parsed.photoDir : null }
  } catch {
    return { photoDir: null }
  }
}

export function saveConfig(dataDir: string, config: Config): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify(config, null, 2))
}
