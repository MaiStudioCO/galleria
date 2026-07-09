# Folder Picker + Clean Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native OS folder picker ("Browse…") and a clean shutdown path (quitting the launcher frees the port, plus an in-app "Quit galleria" button).

**Architecture:** The server invokes the OS folder dialog (osascript / PowerShell) and returns the chosen absolute path, because a browser page can't read one. Shutdown is handled by making `node` the launcher's actual process (`exec`) so quitting the `.app` kills it, plus a `POST /api/shutdown` route and signal handlers that close Fastify and exit.

**Tech Stack:** unchanged — Node 20.19+/Fastify/better-sqlite3 server, React/Vite frontend, Vitest + Playwright. Spec: `docs/superpowers/specs/2026-07-07-folder-picker-and-shutdown-design.md`.

## Global Constraints

- All existing galleria constraints hold (127.0.0.1 only, ESM `.js` import extensions inside `server/`, temp dirs in tests — never the real `~/.galleria`, thumb sizes {96,256,2048}).
- The OS dialog is the only filesystem gate for `/api/pick-folder`; the endpoint never traverses the filesystem itself.
- Folder picker supported on `darwin` and `win32` only; any other platform → HTTP 501 and the editable path field remains the way in.
- `POST /api/shutdown` must send its `200 { ok: true }` response BEFORE the process exits (a fixed short delay is used so the reply flushes).
- Existing e2e testids/ids are unchanged (`folder-input`, `folder-submit`, `add-source-input`, `add-source-submit`, `source-list`, `unlocated-button`, `tray-panel`, `lightbox`, `grid-panel`, `#date-from`, `#date-to`). New testids: `folder-browse`, `add-source-browse`, `quit-button`.
- Work on branch `feat/folder-picker-and-shutdown`; conventional commits; commit per task.
- Playwright e2e stays as-is and must stay green (native dialog + process-exit can't run headless).

## File Structure

```
server/src/folder-picker.ts        # NEW: folderPickerCommand, parsePickerOutput, pickFolder, realPick
server/src/app.ts                  # + AppContext.pickFolder?/onShutdown?; POST /api/pick-folder, POST /api/shutdown
server/src/index.ts                # + SIGTERM/SIGINT handlers on the 'started' path
server/tests/folder-picker.test.ts # NEW: unit tests for the picker module
server/tests/app.test.ts           # + pick-folder + shutdown route tests
scripts/make-launcher.sh           # exec the node server instead of npm start; drop trap
web/src/api.ts                     # + pickFolder(), shutdown()
web/src/components/FirstRun.tsx     # + Browse button
web/src/components/SettingsSheet.tsx# + Browse button (add row) + Quit button
web/src/App.tsx                     # + stopped overlay + onQuit wiring
web/src/styles.css                 # + .danger button styling if not present
README.md                          # mention Browse + Quit
```

---

### Task 1: Folder-picker module

**Files:**
- Create: `server/src/folder-picker.ts`
- Test: `server/tests/folder-picker.test.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `interface PickerCommand { cmd: string; args: string[] }`
  - `interface FolderPick { supported: boolean; path: string | null }`
  - `type SpawnImpl = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>`
  - `folderPickerCommand(platform: NodeJS.Platform): PickerCommand | null`
  - `parsePickerOutput(raw: string): string | null`
  - `pickFolder(platform?: NodeJS.Platform, spawnImpl?: SpawnImpl): Promise<string | null>`
  - `realPick(): Promise<FolderPick>` — `{ supported:false }` on unsupported OS, else `{ supported:true, path }`.

- [ ] **Step 1: Write the failing tests**

`server/tests/folder-picker.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — cannot find module `../src/folder-picker.js`.

- [ ] **Step 3: Implement**

`server/src/folder-picker.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server` and `npm run typecheck -w server`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/folder-picker.ts server/tests/folder-picker.test.ts
git commit -m "feat: native folder-picker command builder, output parser, and spawn wrapper"
```

---

### Task 2: /api/pick-folder route

**Files:**
- Modify: `server/src/app.ts` (extend `AppContext`, add one import, add one route)
- Test: `server/tests/app.test.ts` (append 3 tests)

**Interfaces:**
- Consumes: `realPick`, `FolderPick` from `./folder-picker.js` (Task 1).
- Produces: `AppContext.pickFolder?: () => Promise<FolderPick>` (injectable; default `realPick`). Route `POST /api/pick-folder` → `200 { path: string | null }` | `501 { error }`.

- [ ] **Step 1: Write the failing tests**

Append to `server/tests/app.test.ts`:
```ts
it('POST /api/pick-folder returns the chosen path via the injected picker', async () => {
  const a = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'galleria-pick-')),
    pickFolder: async () => ({ supported: true, path: '/Users/me/Pictures' }),
  })
  const res = await a.inject({ method: 'POST', url: '/api/pick-folder' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ path: '/Users/me/Pictures' })
})

it('POST /api/pick-folder returns { path: null } when cancelled', async () => {
  const a = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'galleria-pick-')),
    pickFolder: async () => ({ supported: true, path: null }),
  })
  const res = await a.inject({ method: 'POST', url: '/api/pick-folder' })
  expect(res.json()).toEqual({ path: null })
})

it('POST /api/pick-folder is 501 when the OS is unsupported', async () => {
  const a = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'galleria-pick-')),
    pickFolder: async () => ({ supported: false, path: null }),
  })
  const res = await a.inject({ method: 'POST', url: '/api/pick-folder' })
  expect(res.statusCode).toBe(501)
})
```
(`mkdtempSync`, `join`, `tmpdir` are already imported at the top of `app.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `pickFolder` not accepted by `AppContext` / route 404.

- [ ] **Step 3: Implement**

In `server/src/app.ts`:

1. Add the import near the other `./…` imports:
```ts
import { realPick, type FolderPick } from './folder-picker.js'
```

2. Extend `AppContext`:
```ts
export interface AppContext {
  dataDir: string
  webDist?: string
  /** Injectable for tests; defaults to the real OS dialog. */
  pickFolder?: () => Promise<FolderPick>
}
```

3. Add this route alongside the other `/api/sources` routes (e.g. right after `POST /api/sources`):
```ts
app.post('/api/pick-folder', async (_req, reply) => {
  const pick = ctx.pickFolder ?? realPick
  const result = await pick()
  if (!result.supported) return reply.code(501).send({ error: 'folder picker not supported on this OS' })
  return { path: result.path }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server` and `npm run typecheck -w server`
Expected: PASS (existing app tests unaffected); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/tests/app.test.ts
git commit -m "feat: POST /api/pick-folder opens the native OS folder dialog"
```

---

### Task 3: /api/shutdown route + shutdown hook + signal handlers

**Files:**
- Modify: `server/src/app.ts` (extend `AppContext`, add one route)
- Modify: `server/src/index.ts` (signal handlers on the started path)
- Test: `server/tests/app.test.ts` (append 1 test)

**Interfaces:**
- Produces: `AppContext.onShutdown?: () => void | Promise<void>` (injectable; default closes the app and exits). Route `POST /api/shutdown` → `200 { ok: true }`, then fires `onShutdown` after a short delay.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/app.test.ts`:
```ts
it('POST /api/shutdown responds ok and fires the shutdown hook once', async () => {
  let calls = 0
  const a = await buildApp({
    dataDir: mkdtempSync(join(tmpdir(), 'galleria-shutdown-')),
    onShutdown: () => { calls++ },
  })
  const res = await a.inject({ method: 'POST', url: '/api/shutdown' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })
  await new Promise((r) => setTimeout(r, 90))
  expect(calls).toBe(1)
  await a.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w server`
Expected: FAIL — `onShutdown` not accepted / route 404.

- [ ] **Step 3: Implement the route**

In `server/src/app.ts`:

1. Extend `AppContext` (add the field alongside `pickFolder?`):
```ts
  /** Injectable for tests; defaults to closing the server and exiting the process. */
  onShutdown?: () => void | Promise<void>
```

2. After `const app = Fastify()` (and after `scanManager` is created), add:
```ts
const onShutdown = ctx.onShutdown ?? (async () => { await app.close(); process.exit(0) })
```

3. Add the route (near `/api/scan`):
```ts
app.post('/api/shutdown', async () => {
  // Respond first, then shut down — the 50 ms delay lets the reply flush to the
  // browser before the process exits and the port is freed.
  setTimeout(() => { void onShutdown() }, 50)
  return { ok: true }
})
```

- [ ] **Step 4: Add signal handlers in the entry point**

Replace the tail of `server/src/index.ts` (the `if (result === 'started') …` block) so the started path installs SIGTERM/SIGINT handlers:
```ts
const result = await startOrAttach({ app, host, port, openBrowser })

if (result === 'started') {
  console.log(`galleria running at ${url} (data: ${dataDir})`)
  const stop = () => void app.close().then(() => process.exit(0))
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else {
  console.log(`galleria is already running — opened ${url} in your browser`)
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w server` and `npm run typecheck -w server`
Expected: PASS; typecheck clean. (The signal handlers are exercised manually in Task 4's verification.)

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/tests/app.test.ts
git commit -m "feat: POST /api/shutdown and SIGTERM/SIGINT handlers free the port on quit"
```

---

### Task 4: macOS launcher execs the server (frees the port on quit)

**Files:**
- Modify: `scripts/make-launcher.sh` (the launcher heredoc)

**Interfaces:** none (build-time script). Consumes the server entry from Task 3.

- [ ] **Step 1: Replace the launcher heredoc**

In `scripts/make-launcher.sh`, replace the block that writes `$APP/Contents/MacOS/galleria` (currently `npm start` with a `trap 'kill 0'`) with this version — build first, then `exec` node so it becomes the app's process:
```bash
# 3. The launcher itself. Builds the web app, then EXECs the server so node IS the
#    app's process — quitting the app (Dock -> Quit, or force-quit) kills node
#    directly and frees the port. A Terminal-like PATH makes node/npm resolvable.
cat > "$APP/Contents/MacOS/galleria" <<LAUNCH
#!/bin/zsh
export PATH="\$(/bin/zsh -lc 'echo \$PATH' 2>/dev/null):/opt/homebrew/bin:/usr/local/bin:\$HOME/.npm-global/bin:\$PATH"
cd "$REPO" || exit 1
npm run build -w web || exit 1
exec node_modules/.bin/tsx server/src/index.ts
LAUNCH
chmod +x "$APP/Contents/MacOS/galleria"
```

- [ ] **Step 2: Rebuild the launcher and check the generated script**

Run:
```bash
npm run make-app
grep -q 'exec node_modules/.bin/tsx' "$HOME/Desktop/Galleria.app/Contents/MacOS/galleria" && echo "exec present"
grep -q "trap 'kill 0'" "$HOME/Desktop/Galleria.app/Contents/MacOS/galleria" && echo "OOPS trap still there" || echo "trap removed"
```
Expected: `exec present` and `trap removed`.

- [ ] **Step 3: Manual verification (record in the report)**

- Ensure nothing is on port 3000 (`lsof -ti tcp:3000 | xargs kill 2>/dev/null`).
- Double-click `~/Desktop/Galleria.app`, wait for the browser to open, then quit it from the Dock (right-click → Quit).
- Confirm the port is freed: `lsof -nP -iTCP:3000 -sTCP:LISTEN` prints nothing.
Record the observed result in the task report. (This is the manual gate — a GUI quit can't be asserted in CI.)

- [ ] **Step 4: Commit**

```bash
git add scripts/make-launcher.sh
git commit -m "feat: macOS launcher execs the node server so quitting frees the port"
```

---

### Task 5: Frontend Browse buttons

**Files:**
- Modify: `web/src/api.ts` (add `pickFolder`)
- Modify: `web/src/components/FirstRun.tsx` (Browse button)
- Modify: `web/src/components/SettingsSheet.tsx` (Browse button in the add row)

**Interfaces:**
- Consumes: `POST /api/pick-folder` (Task 2).
- Produces: `pickFolder(): Promise<{ path: string | null }>` in `web/src/api.ts`.

- [ ] **Step 1: Add the api client function**

In `web/src/api.ts`, add after `startScan`:
```ts
export const pickFolder = () =>
  fetch('/api/pick-folder', { method: 'POST' }).then(
    (r) => (r.ok ? (r.json() as Promise<{ path: string | null }>) : { path: null }),
  )
```

- [ ] **Step 2: Add Browse to FirstRun**

In `web/src/components/FirstRun.tsx`:
1. Change the import to include `pickFolder`:
```ts
import { addSource, pickFolder } from '../api'
```
2. Add a handler inside the component (after `submit`):
```ts
const browse = async () => {
  const { path } = await pickFolder()
  if (path) setDir(path)
}
```
3. Add a Browse button immediately after the `folder-submit` button:
```tsx
<button data-testid="folder-browse" onClick={() => void browse()}>
  Browse…
</button>
```

- [ ] **Step 3: Add Browse to SettingsSheet's add row**

In `web/src/components/SettingsSheet.tsx`:
1. Change the import to include `pickFolder`:
```ts
import { addSource, deleteSource, patchSource, pickFolder, startScan, type Source } from '../api'
```
2. Add a handler (after `add`):
```ts
const browse = async () => {
  const { path } = await pickFolder()
  if (path) setNewPath(path)
}
```
3. Add a Browse button in the add `row`, immediately after the `add-source-submit` button:
```tsx
<button data-testid="add-source-browse" onClick={() => void browse()}>
  Browse…
</button>
```

- [ ] **Step 4: Verify**

Run: `npm run build -w web` (tsc + vite must pass), `npm test -w web` (6/6), `npm test -w server`.
Expected: all green. (The live dialog is manually verified in Task 7's run; e2e still uses the path field and is unaffected.)

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/components/FirstRun.tsx web/src/components/SettingsSheet.tsx
git commit -m "feat: Browse buttons open the native folder picker in first-run and settings"
```

---

### Task 6: Frontend Quit button + stopped overlay

**Files:**
- Modify: `web/src/api.ts` (add `shutdown`)
- Modify: `web/src/components/SettingsSheet.tsx` (Quit button + `onQuit` prop)
- Modify: `web/src/App.tsx` (stopped overlay + wire `onQuit`)
- Modify: `web/src/styles.css` (ensure a `.danger` button style exists)

**Interfaces:**
- Consumes: `POST /api/shutdown` (Task 3).
- Produces: `shutdown(): Promise<Response>` in `web/src/api.ts`; `SettingsSheetProps.onQuit: () => void`.

- [ ] **Step 1: Add the api client function**

In `web/src/api.ts`, add after `pickFolder`:
```ts
export const shutdown = () => fetch('/api/shutdown', { method: 'POST' })
```

- [ ] **Step 2: Add the Quit button to SettingsSheet**

In `web/src/components/SettingsSheet.tsx`:
1. Extend the import: `import { addSource, deleteSource, patchSource, pickFolder, shutdown, startScan, type Source } from '../api'`
2. Extend the props:
```ts
export interface SettingsSheetProps {
  sources: Source[]
  onClose: () => void
  onChanged: () => void
  onQuit: () => void
}
```
and destructure `onQuit` in the component signature.
3. Add quit state + handler (near the other `useState`s and handlers):
```ts
const [confirmQuit, setConfirmQuit] = useState(false)
const quit = async () => {
  await shutdown()
  onQuit()
}
```
4. Add a Quit row right before the closing `</div>` of the sheet (after the "Rescan all" row):
```tsx
<div className="row">
  {confirmQuit ? (
    <button className="danger" data-testid="quit-button" onClick={() => void quit()}>
      Quit — are you sure?
    </button>
  ) : (
    <button data-testid="quit-button" onClick={() => setConfirmQuit(true)}>
      Quit galleria
    </button>
  )}
</div>
```

- [ ] **Step 3: Wire the overlay in App**

In `web/src/App.tsx`:
1. Add near the other `useState` calls:
```ts
const [stopped, setStopped] = useState(false)
```
2. Add an early return, placed right after the existing `if (sources.length === 0) { return <FirstRun … /> }` block:
```tsx
if (stopped) {
  return (
    <div className="first-run">
      <h1>galleria</h1>
      <p>galleria has stopped — you can close this tab.</p>
    </div>
  )
}
```
3. Pass `onQuit` to `SettingsSheet` (add the prop to the existing `<SettingsSheet … />`):
```tsx
onQuit={() => setStopped(true)}
```

- [ ] **Step 4: Ensure the `.danger` button style exists**

Check `web/src/styles.css` for a `.danger` rule (the source-remove confirm uses `.source-remove.danger`). Add a general one if missing — append:
```css
button.danger {
  background: #b3261e;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
```

- [ ] **Step 5: Verify**

Run: `npm run build -w web`, `npm test -w web`, `npm test -w server`.
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/components/SettingsSheet.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat: in-app Quit button shuts the server down and shows a stopped overlay"
```

---

### Task 7: README + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

In `README.md`, in the first-launch paragraph (the one that starts "`npm start` builds the app…"), add a sentence about Browse and Quit. Replace the sentence that begins "On first launch, paste the path to a photo folder" with:
```
On first launch, click **Browse…** to pick a photo folder (or paste its path).
Add more folders anytime from the settings gear (⚙), where each folder can also
be hidden or removed, and a **Quit galleria** button cleanly stops the app.
```

- [ ] **Step 2: Full verification**

Run:
```bash
npm test                              # server (incl. new suites) + web
npm run build -w web
lsof -ti tcp:3000 | xargs kill 2>/dev/null; sleep 1
npm run e2e                           # must stay 5/5
```
Expected: server suite green (folder-picker + pick-folder + shutdown tests included), web build clean, e2e 5/5.

- [ ] **Step 3: Manual smoke (record in report)**

- `npm start`; in the app click **Browse…** on first-run/settings → the native macOS folder dialog appears and the chosen path fills the field.
- Click the gear → **Quit galleria** → confirm → the "galleria has stopped" overlay appears and `lsof -nP -iTCP:3000 -sTCP:LISTEN` prints nothing.
Record results in the report.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: mention Browse folder picker and Quit button"
```
