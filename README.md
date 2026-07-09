# galleria — your photos on a world map

A local webapp that reads the location and date (EXIF metadata) of your photos
and shows them as clustered thumbnails on a world map — like the iPhone Photos
map, for any folders you choose. Add several folders, hide or remove them
individually, and filter everything by a date-range slider.

Everything stays on your machine: your photos are indexed into a local folder
(`~/.galleria`) and never uploaded. The only thing fetched from the internet is
the generic map background.

## Install (one time)

You need two free tools first:

- **Node.js** version 20.19 or newer — https://nodejs.org (the "LTS" download)
- **git** — https://git-scm.com/downloads

Then, in a terminal (from your **home folder** — see the macOS note below):

    cd ~
    git clone https://github.com/MaiStudioCO/galleria.git
    cd galleria
    npm install
    npm start

> **macOS:** keep this folder in your home directory (e.g. `~/galleria`), **not**
> in Desktop, Documents, or Downloads. Those folders have privacy protections
> that stop the one-click **Galleria.app** from launching (it opens and instantly
> quits). Running from `~/galleria` avoids it. If you already cloned into a
> protected folder, move it — `mv ~/Desktop/galleria ~/galleria` — then re-run
> `npm run make-app`.

`npm start` builds the app, starts it at http://127.0.0.1:3000, and opens your
browser. On first launch, click **Browse…** to pick a photo folder (or paste its path).
Add more folders anytime from the settings gear (⚙), where each folder can also
be hidden or removed, and a **Quit galleria** button cleanly stops the app. The first scan of a large
library takes a few minutes; after that it's instant.

To run it again later, just `cd galleria` and `npm start`.

### One-click launcher (optional)

Prefer an icon over the terminal? Run this once:

    npm run make-app

- **macOS:** builds **Galleria.app** on your Desktop. Double-click it (it opens
  your browser automatically), or drag it into your Dock.
- **Windows:** builds a **Galleria** shortcut on your Desktop with an icon.
  Double-click it, or right-click → Pin to taskbar / Start.

Re-run `npm run make-app` only if you move the project folder.

On **Windows** you can also just double-click **`Galleria.cmd`** in the project
folder — no setup, it starts the app straight away.

## Update (whenever there's a new version)

From the `galleria` folder:

    npm run update
    npm start

`npm run update` pulls the latest code and installs anything new. Your photos,
folder list, and index live in `~/.galleria`, completely separate from the app —
updates never touch them, and any database changes are applied automatically the
next time you start.

## Develop

    npm run dev        # server (:3000) + Vite dev server (:5173), both auto-reload
    npm test           # unit tests (server + web)
    npm run e2e        # Playwright end-to-end tests

Env vars: `GALLERIA_DATA_DIR` (default `~/.galleria`), `PORT` (default 3000),
`GALLERIA_NO_OPEN=1` to skip opening the browser.
