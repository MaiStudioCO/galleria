# Folder Picker + Clean Shutdown — Design Spec

**Date:** 2026-07-07
**Status:** Approved by user (brainstorming session)
**Builds on:** galleria (photo map + multi-source folders, both merged to main)

## Summary

Two independent enhancements to galleria:

1. **Native folder picker** — a "Browse…" button that opens the real macOS/Windows
   folder chooser and fills the path field, instead of only pasting a path string.
2. **Clean shutdown** — quitting the launcher reliably stops the server and frees
   the port, plus an in-app "Quit galleria" button as an explicit off-switch.

The web page cannot read an absolute filesystem path from a native file input, so
folder picking is solved by having the local server invoke the OS dialog and
return the chosen path. "Closing the app" means quitting the launcher (the browser
tab is intentionally decoupled from the server).

---

## Feature 1: Native folder picker

### Server

New module `server/src/folder-picker.ts`:

- `folderPickerCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } | null`
  - `darwin` → `osascript -e 'POSIX path of (choose folder with prompt "Choose a photo folder for Galleria")'`
  - `win32` → `powershell -NoProfile -STA -Command "<FolderBrowserDialog snippet that writes SelectedPath to stdout>"`
  - anything else → `null` (unsupported)
- `parsePickerOutput(raw: string): string | null` — trims whitespace/newline and a
  single trailing path separator (osascript POSIX paths end in `/`); empty → `null`.
  Never reduces the result below `/`.
- `pickFolder(spawnImpl?): Promise<string | null>` — spawns the command, resolves to
  the parsed path on success, `null` on cancel or non-zero exit. `spawnImpl` is
  injectable for tests.

New route `POST /api/pick-folder`:
- If `folderPickerCommand(process.platform)` is `null` → `501 { error: 'folder picker not supported on this OS' }`.
- Otherwise run `pickFolder()` → `200 { path: string | null }` (`null` = the user cancelled).

The OS dialog gates all filesystem access — the endpoint never traverses the
filesystem itself, so it adds no path-traversal surface. Server is 127.0.0.1-only,
unchanged.

### Frontend

- `web/src/api.ts`: `pickFolder(): Promise<{ path: string | null }>` (treats a
  non-OK response, e.g. 501, as `{ path: null }`).
- A **"Browse…"** button beside the path input in **both** `FirstRun` and the
  Settings "add folder" row. Click → `pickFolder()` → on a returned path, set the
  input value (`setDir` / `setNewPath`). The user then confirms with the existing
  **Scan / Add** button, which POSTs the path through the existing validated
  endpoints. The text field stays editable — typing a path still works, and it is
  the fallback where no dialog exists (Linux).

### Edge cases

- **Cancel** → `{ path: null }` → the field is left unchanged.
- **Unsupported OS** → Browse is a no-op; the path field remains the way in.
- One dialog at a time is assumed (single-user local app); no concurrency guard.

### Testing

- `server/tests/folder-picker.test.ts`: `folderPickerCommand` returns the right
  shape for `darwin`/`win32` and `null` for `linux`; `parsePickerOutput` trims and
  strips a trailing slash, maps empty/cancel to `null`; `pickFolder` with an
  injected fake spawn returns the parsed path on success and `null` on non-zero exit.
- The live native dialog is manually verified on macOS — a GUI dialog cannot run in
  headless tests. Playwright e2e is unchanged (it keeps using the path field).

---

## Feature 2: Clean shutdown that frees the port

### Quitting the launcher

The macOS launcher currently runs `npm start`, leaving `node` as a grandchild that
can be orphaned (the source of the stale-port bug). Change the generated
`Contents/MacOS/galleria` to build first, then **`exec`** the server so `node`
*becomes* the app's process:

```zsh
#!/bin/zsh
export PATH="…"            # unchanged PATH reconstruction
cd "<REPO>" || exit 1
npm run build -w web || exit 1
exec node_modules/.bin/tsx server/src/index.ts
```

With `exec`, quitting the `.app` (Dock → Quit sends SIGTERM; force-quit sends
SIGKILL) signals `node` directly, so the port is freed either way. The `trap 'kill 0'`
line is removed (no longer needed — node is the process, not a grandchild).

`Galleria.cmd` (Windows) is left as `npm start`: closing the console window already
terminates the console's process tree, and the in-app Quit button (below) plus the
server's signal handlers cover the rest.

### Server signal handling

`server/src/index.ts`, after a successful `'started'` result, wires
`process.on('SIGTERM')` and `process.on('SIGINT')` to a shutdown that runs
`app.close()` then `process.exit(0)`. (The `'attached'` path already exits on its own.)

### In-app Quit button

- `buildApp`'s `AppContext` gains an optional `onShutdown?: () => void | Promise<void>`
  hook (default wired in `index.ts` to `async () => { await app.close(); process.exit(0) }`).
- New route `POST /api/shutdown`: sends `200 { ok: true }`, and after the response
  has flushed (`reply.raw` `finish`), invokes `onShutdown`. Freeing the port.
- `web/src/api.ts`: `shutdown(): Promise<Response>` → `POST /api/shutdown`.
- Settings gains a **"Quit galleria"** button (danger-styled, behind an inline
  confirm like Remove). On confirm → `shutdown()` → App renders a full-screen
  "galleria has stopped — you can close this tab." overlay (reusing `.first-run`
  styling). No further requests are made after that.

### Testing

- `server/tests/app.test.ts` (or `serve.test.ts`): `POST /api/shutdown` returns
  `200 { ok: true }` and invokes the injected `onShutdown` spy exactly once, without
  killing the test process (the hook is injected, so no real `process.exit`).
- The signal-handler wiring and the real quit-frees-the-port behavior are manually
  verified (`lsof -iTCP:3000` empty after Dock-Quit and after the in-app Quit).

---

## Non-goals

- No in-app folder-browser tree (native dialog chosen instead).
- No auto-shutdown when the last browser tab closes (rejected — an accidental tab
  close must not kill a running scan).
- Linux native dialog is out of scope (path field remains the way in there).

## Decisions log

| Decision | Choice |
|---|---|
| Folder selection | Native OS dialog via a server endpoint (osascript / PowerShell); path field kept as fallback |
| "Closing the app" | Quitting the launcher frees the port; browser tab stays decoupled from the server |
| Off-switch | Launcher quit **and** an in-app "Quit galleria" button (`POST /api/shutdown`) |
| macOS launcher | `exec` the node server so quitting the `.app` kills it directly |
| Auto-stop on tab close | Rejected (would kill running scans) |
| Testing the untestable | Pure command-builder/parser + injected spawn/shutdown hooks unit-tested; live dialog & signal quit manually verified |
