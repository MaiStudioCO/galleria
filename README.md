# yufu — your photos on a world map

A local webapp that reads the EXIF metadata of a photo folder (JPEG/PNG) and
shows the photos as clustered thumbnails on a world map, filtered by a
date-range slider — like the iPhone Photos map, for any folder.

Everything stays on your machine: photos are indexed into `~/.yufu` and only
generic basemap tile requests go to the internet.

## Run

    npm install
    npm start          # builds the frontend, starts http://127.0.0.1:3000, opens your browser

On first launch, enter the path to your photo folder — you can add more
folders later in settings (⚙), where each folder can also be hidden or
removed independently. The initial scan of a large library takes a few
minutes; rescans are incremental and fast.

## Develop

    npm run dev        # tsx watch server (:3000) + Vite dev server (:5173)
    npm test           # unit tests (server + web)
    npm run e2e        # Playwright end-to-end tests

Env vars: `YUFU_DATA_DIR` (default `~/.yufu`), `PORT` (default 3000),
`YUFU_NO_OPEN=1` to skip opening the browser.
