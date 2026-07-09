import { describe, expect, it } from 'vitest'
import { folderPickerCommand, parsePickerOutput, pickFolder } from '../src/folder-picker.js'

describe('folderPickerCommand', () => {
  it('returns an osascript command on macOS', () => {
    const c = folderPickerCommand('darwin')
    expect(c?.cmd).toBe('osascript')
    expect(c?.args.join(' ')).toContain('choose folder')
  })
  it('returns a powershell command on Windows', () => {
    const c = folderPickerCommand('win32')
    expect(c?.cmd).toBe('powershell')
    expect(c?.args).toContain('-STA')
  })
  it('returns null on unsupported platforms', () => {
    expect(folderPickerCommand('linux')).toBeNull()
  })
})

describe('parsePickerOutput', () => {
  it('trims whitespace and a trailing slash', () => {
    expect(parsePickerOutput('/Users/me/Pictures/\n')).toBe('/Users/me/Pictures')
  })
  it('keeps a path without a trailing slash', () => {
    expect(parsePickerOutput('C:\\Users\\me\\Pictures')).toBe('C:\\Users\\me\\Pictures')
  })
  it('maps empty/cancel output to null', () => {
    expect(parsePickerOutput('')).toBeNull()
    expect(parsePickerOutput('  \n')).toBeNull()
  })
  it('never strips below root', () => {
    expect(parsePickerOutput('/')).toBe('/')
  })
})

describe('pickFolder', () => {
  it('returns the parsed path on success', async () => {
    const fake = async () => ({ code: 0, stdout: '/Users/me/Pictures/\n' })
    expect(await pickFolder('darwin', fake)).toBe('/Users/me/Pictures')
  })
  it('returns null when the dialog is cancelled (non-zero exit)', async () => {
    const fake = async () => ({ code: 1, stdout: '' })
    expect(await pickFolder('darwin', fake)).toBeNull()
  })
  it('returns null on an unsupported platform without spawning', async () => {
    let spawned = false
    const fake = async () => { spawned = true; return { code: 0, stdout: 'x' } }
    expect(await pickFolder('linux', fake)).toBeNull()
    expect(spawned).toBe(false)
  })
})
