// Cross-platform dispatcher for `npm run make-app`.
// macOS  -> builds Galleria.app on the Desktop (make-launcher.sh)
// Windows -> builds a Galleria Desktop shortcut with an icon (make-launcher.ps1)
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1

let status
if (process.platform === 'darwin') {
  status = run('bash', [join(dir, 'make-launcher.sh')])
} else if (process.platform === 'win32') {
  status = run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', join(dir, 'make-launcher.ps1')])
} else {
  console.log('No desktop launcher for this OS yet — just run `npm start`.')
  status = 0
}
process.exit(status)
