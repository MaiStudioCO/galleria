import { spawn } from 'node:child_process'

export interface PickerCommand {
  cmd: string
  args: string[]
}

export interface FolderPick {
  supported: boolean
  path: string | null
}

export type SpawnImpl = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>

const WIN_PS = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
  "$d.Description = 'Choose a photo folder for Galleria';",
  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
].join(' ')

export function folderPickerCommand(platform: NodeJS.Platform): PickerCommand | null {
  if (platform === 'darwin') {
    return {
      cmd: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "Choose a photo folder for Galleria")'],
    }
  }
  if (platform === 'win32') {
    return { cmd: 'powershell', args: ['-NoProfile', '-STA', '-Command', WIN_PS] }
  }
  return null
}

export function parsePickerOutput(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  // osascript POSIX paths end with a trailing slash; strip one, but never below "/".
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1)
  return trimmed
}

const defaultSpawn: SpawnImpl = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args)
    let stdout = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.on('error', () => resolve({ code: 1, stdout: '' }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })

export async function pickFolder(
  platform: NodeJS.Platform = process.platform,
  spawnImpl: SpawnImpl = defaultSpawn,
): Promise<string | null> {
  const command = folderPickerCommand(platform)
  if (!command) return null
  const { code, stdout } = await spawnImpl(command.cmd, command.args)
  if (code !== 0) return null // user cancelled, or the dialog failed
  return parsePickerOutput(stdout)
}

export async function realPick(): Promise<FolderPick> {
  if (folderPickerCommand(process.platform) === null) return { supported: false, path: null }
  return { supported: true, path: await pickFolder() }
}
