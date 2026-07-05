import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadConfig, saveConfig } from '../src/config.js'

it('defaults to null photoDir when no config exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yufu-cfg-'))
  expect(loadConfig(dir)).toEqual({ photoDir: null })
})

it('round-trips a saved config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yufu-cfg-'))
  saveConfig(dir, { photoDir: '/Users/me/Pictures' })
  expect(loadConfig(dir)).toEqual({ photoDir: '/Users/me/Pictures' })
})

it('survives a corrupt config file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yufu-cfg-'))
  writeFileSync(join(dir, 'config.json'), '{not json')
  expect(loadConfig(dir)).toEqual({ photoDir: null })
})
