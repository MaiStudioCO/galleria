# Photo Map — Design Spec

**Date:** 2026-07-06
**Status:** Approved by user (brainstorming session)

## Summary

A local webapp that indexes a user-chosen folder of photos, reads their EXIF metadata, and displays them on an interactive world map (iPhone Photos-style clustered thumbnails) with a dual-handle date-range slider and date input fields for time filtering. Everything runs locally; only generic map-tile requests go to the internet.

## Requirements

- **Scale:** 50k+ photos; library changes over time.
- **Formats:** JPEG and PNG only.
- **Map:** online vector tiles (OpenFreeMap or Carto via MapLibre — free, no API key), street-level detail everywhere. Photos and metadata never leave the machine.
- **Date filter:** dual-handle range slider spanning the library's date span, plus From/To date input fields kept in sync with the handles. A histogram of photo counts renders behind the slider.
- **Cluster interaction:** clicking a cluster zooms the map into its bounds; when a cluster cannot split further at max zoom, a grid panel slides up with that cluster's photos; clicking a photo opens a fullscreen lightbox (arrow keys, zoom, EXIF details, "show on map").
- **Photos without GPS:** shown in a separate "unlocated" tray — a counter button opening a side panel with a date-filtered grid, same lightbox.
- **Folder selection:** chosen in the UI on first run, stored in config, changeable later in a settings sheet; manual "Rescan" button.
- **Stack:** Node.js backend, React frontend.

## Architecture

One Node.js process serving both the REST API and the built frontend. `npm start` launches the server on `http://127.0.0.1:3000` and opens the browser.

```
Browser: React + Vite + MapLibre GL (OpenFreeMap tiles) + supercluster
   │ REST + SSE (localhost only)
Node: Fastify
   ├─ Scanner: exifr → SQLite (better-sqlite3)
   ├─ Thumbnailer: sharp, lazy generation + disk cache
   └─ Photo / config / scan API
Photo folder: read-only. App data in ~/.yufu/ (db, thumbs, config).
```

## Backend components

### Scanner
- Recursively walks the configured folder for `.jpg/.jpeg/.png`.
- Reads EXIF via `exifr`: GPS lat/lon, `DateTimeOriginal`, dimensions, orientation.
- Upserts into SQLite; incremental — skips files whose path+mtime+size already match the index; removes rows for deleted files.
- Runs on folder change (first configure) and on manual Rescan.
- Streams progress to the UI via Server-Sent Events.
- Missing EXIF date → fall back to file mtime. Missing/invalid GPS → `lat/lon = NULL` (unlocated).

### Index (SQLite)
Single table:
`photos(id, path, lat, lon, taken_at, width, height, mtime, size)`
Indexes on `taken_at` and `(lat, lon)`. 50k rows: date+geo queries return in milliseconds.

### Thumbnailer
- `GET /thumb/:id?size={96|256|2048}` — generated on first request with `sharp`, cached in `~/.yufu/thumbs/`, served from cache afterwards.
- 96 = map markers, 256 = grid cells, 2048 = lightbox; original file also downloadable.

### API
- `GET /api/photos?from&to` — full geolocated point list (id, lat, lon, taken_at). ~2 MB JSON at 50k; fetched once, filtered client-side thereafter.
- `GET /api/photos/unlocated?from&to&page` — paginated unlocated photos.
- `GET /api/photos/:id` — full metadata for lightbox.
- `GET /api/config` / `PUT /api/config` — folder path.
- `POST /api/scan` — trigger rescan. `GET /api/scan/events` — SSE progress.

## Frontend / UX

- **Map** fills the viewport. Light/dark basemap follows system theme. Clusters render as rounded-square thumbnails of the cluster's most recent photo with a count badge (iPhone Photos style). Clustering via `supercluster` in a web worker.
- **Timeline bar**: floating glass panel at the bottom; dual-handle range slider with photo-count histogram; From/To date inputs beside it, two-way synced. Filter changes re-cluster entirely client-side (target <16 ms, no network).
- **Unlocated tray**: counter button ("N photos without location") opens a side panel grid respecting the current date range.
- **First run**: welcome screen asks for folder path, starts initial scan with progress bar. **Settings sheet**: change folder, rescan.
- Thumbnails lazy-load as markers/grid cells enter view.

## Data flow

1. Startup → fetch config; no folder configured → first-run screen.
2. Fetch point list once → build supercluster index in a web worker → render clusters.
3. Slider/date input change → filter points in worker → update clusters (no server round-trip).
4. Cluster click → zoom to bounds; at max zoom → grid panel; photo click → lightbox.

## Error handling

- Corrupt/unreadable files: skipped, counted, surfaced as "N files skipped"; never abort the scan.
- Invalid GPS (0,0 or out-of-range): treated as unlocated.
- Photo folder missing/unmounted: banner with "change folder" action; cached index still browsable.
- Tile service unreachable: clusters render on a plain background with a notice.
- Server binds to `127.0.0.1` only.

## Testing

- **Unit (Vitest):** EXIF→record mapper (GPS edge cases, missing dates, orientation), scanner incrementality (add/modify/delete), date-filter API — against a fixture folder of small generated JPEGs with synthetic EXIF.
- **E2E (Playwright):** start server on fixtures; assert clusters render, slider narrows results, grid + lightbox open, unlocated tray counts match.
- **Perf:** manual check against the real 50k library (scan time, initial load, slider latency) before completion.

## Decisions log

| Decision | Choice |
|---|---|
| Library size | 50k+, changing |
| Formats | JPEG/PNG only |
| Date filter | Dual-handle range slider + date inputs |
| No-GPS photos | Separate unlocated tray |
| Stack | Node.js (Fastify, better-sqlite3, sharp, exifr) + React/MapLibre |
| Cluster click | Zoom-in, grid at max zoom, lightbox |
| Map tiles | Online (initially "fully offline", revised by user to online for street-level detail) |
| Folder choice | UI-configurable, stored in config |
| Architecture | A: local Node server + browser frontend |
