# Multi-Source Folders — Design Spec

**Date:** 2026-07-06
**Status:** Approved by user (brainstorming session)
**Builds on:** `2026-07-06-photo-map-design.md` (implemented; merged to main)

## Summary

Replace yufu's single configured `photoDir` with multiple **source folders** that can be added, removed, and shown/hidden individually. The library stays merged: one map, one timeline, one tray — with per-source visibility toggles in settings.

## Decisions

| Decision | Choice |
|---|---|
| Browsing model | Merged library; per-source show/hide (eye) toggles in settings — no per-source colors or main-UI chips |
| Removing a source | Deletes its photo rows from the index immediately (files untouched); re-adding rescans fresh |
| Scanning | One "rescan all enabled sources" flow with a single aggregated progress bar; a newly added source scans immediately (just that folder) |
| Overlapping folders | Rejected: a new source may not be inside, or contain, an existing source (canonical-path, separator-aware check) → 409 |
| Architecture | Sources table in SQLite + `source_id` FK on photos; config.json no longer stores folders |

## Data model & migration

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE photos ADD COLUMN source_id INTEGER NOT NULL REFERENCES sources(id);
CREATE INDEX idx_photos_source ON photos(source_id);
```

`openDb` migration (idempotent, runs at startup):
1. Create `sources` if missing.
2. Add `photos.source_id` if missing (SQLite ALTER with a default, then backfill).
3. If `sources` is empty AND `config.photoDir` is set: insert that path as source 1 (enabled), backfill every existing photo row with `source_id = 1`, remove `photoDir` from config.json. Existing index survives with no rescan.

`config.json` remains for future app settings; it no longer stores folders after migration.

## API

- `GET /api/sources` → `[{ id, path, enabled, exists, photoCount }]` (`exists`: directory reachable now — powers the banner).
- `POST /api/sources` body `{path}` → 400 not a directory; 409 nested inside/containing an existing source (message names the conflicting source); on success inserts enabled, starts a scan of that folder only, returns the source row.
- `DELETE /api/sources/:id` → deletes the source and all its photo rows in one transaction; 404 unknown id.
- `PATCH /api/sources/:id` body `{enabled: boolean}` → toggles visibility; 404 unknown id.
- `GET /api/photos`, `GET /api/photos/unlocated`, `GET /api/library` all filter by `source_id IN (SELECT id FROM sources WHERE enabled = 1)`.
- `POST /api/scan` → rescans all enabled sources (202/409 semantics unchanged).
- `PUT /api/config` `photoDir` alias is REMOVED; FirstRun switches to `POST /api/sources`. `GET /api/config` drops `photoDir`/`folderExists` (replaced by `/api/sources`); frontend stops consuming them. First-run detection = `GET /api/sources` returns an empty list.

## Scanning

- `scanFolder(db, sourceId, folder, onProgress?)`: stamps `source_id` on upserts; deletion sweep scoped to that source's rows (`WHERE source_id = ?` state map).
- New orchestration `ScanManager.startAll(db, sources)`: lists files for every enabled source first so the progress total is global, then scans source-by-source; emits the same `progress`/`done`/`failed` events with aggregated counts. `done` payload includes per-source results plus totals.
- An unreachable source folder fails only that source: it's reported in the result (`{ sourceId, error }`) and remaining sources still scan.
- Queued-scan behavior carries over: a source add/rescan during a running scan queues one follow-up scan-all (latest wins).
- Scanner checks the source still exists in the DB before applying its deletion sweep (guards against a source deleted mid-scan; a rare orphan upsert is acceptable and swept next scan).

## Frontend

- **SettingsSheet → source manager:** list of source rows — folder name (full path in `title` tooltip), photo count, eye toggle (PATCH), remove button with inline confirm (DELETE) — plus an "Add folder" path input + button (POST), the existing Rescan-all button, live scan progress, and skipped-files count.
- Any source mutation (add/remove/toggle) refetches sources + points + library bounds; the map re-clusters through the existing worker path. The timeline span follows enabled sources because `/api/library` respects toggles.
- **FirstRun:** unchanged visually; submits `POST /api/sources`; shown when the sources list is empty.
- **Missing-folder banner:** shows when any *enabled* source has `exists: false`, naming the folder; "Change folder" button opens settings (unchanged behavior, new data source).

## Error handling

- Nested check: `path.resolve` both paths; reject when one is a prefix of the other **at a path-separator boundary** (`/a/b` blocks `/a/b/c`, does not block `/a/bc`).
- DELETE and its photo-row cascade run in a single transaction.
- Toggling all sources off is allowed: map/timeline/tray render empty (bounds null → same as an empty library); settings remains reachable to toggle back.
- Thumbnails are untouched: cache keys are `id_mtime_size` and deleting rows only orphans cache files (bounded, existing accepted behavior).

## Testing

- **Unit (server):** migration (photoDir → source + backfill, idempotency on second open); nested rejection matrix (child, parent, equal, sibling-with-common-prefix); DELETE cascades rows; enabled filtering in photos/unlocated/library queries; multi-source scan (aggregated progress reaches the global total; deletion sweep only touches its own source; one unreachable source doesn't abort others).
- **API:** full CRUD on /api/sources incl. 400/404/409 paths; scan-all result shape.
- **E2E:** seed two fixture folders via POST /api/sources; assert combined marker/tray counts; PATCH one disabled → counts drop without rescan; DELETE it → counts drop permanently. First-run flow seeds through the sources endpoint.
- Existing suites must stay green; e2e seeding switches from PUT /api/config to POST /api/sources.
