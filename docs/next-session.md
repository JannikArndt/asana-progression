# Plan for the next session

State on main: milestones 1–4 done, M5 partly done (catalog/template editor, re-import with
re-capture). Everything below is open. Read CLAUDE.md first; it is the source of truth for
architecture, commands and measured iOS limits.

## 1. Failed video (user will upload a debug file)

- The user will attach a diagnostics report / analysis export for a video that failed.
- Reproduce from the report: codec string, pixel format, `decoderSupport` variants, sampler stats
  (`framesDecoded`, `packetsSkipped`, `maxDecodeQueue`), error text and the stage it failed in.
- Likely areas: `source/media.ts` (decoder config, `hvc1`/`hev1`), `source/sampler.ts`
  (non-reference skipping, frame release while waiting/flushing — changed in this session),
  `ui/pipeline/controller.svelte.ts` (retry logic).
- If it is a detection miss, not a crash: add the export to `src/detection/__fixtures__/real/` with
  a `truth` array (incl. confirmed `bestS`) and tune via `DetectionParams`, never special-case.

## 2. Backup export/import (M5, highest value)

iOS can evict website data, and `persist()` was refused in a Safari tab, so this protects years of
labels.

- `storage/zip.ts`: STORE-only ZIP writer/reader, no dependencies. CRC32 is computed by
  streaming. The output Blob is built from the original file Blobs, so nothing is copied into memory.
  ZIP64 only when a size or offset ≥ 4 GiB (original-quality clips can exceed that in total).
  Reader parses the EOCD (+ ZIP64 locator) and local headers and rejects compressed entries.
- `storage/backup.ts`: `backup.json` = all repositories except `jobs`, plus settings. This needs
  `KeyValueStore.entries()`. Typed arrays (Analysis.m/C) are encoded as `{$typed, b64}`. Asset
  files go under their `storageKey`. Import merges by id: records first, then files.
- Run import in a worker: OPFS writes need sync access handles on iOS, and main-thread
  `createWritable` may be missing. Export can run on the main thread and download via an
  `<a download>` object URL.
- Samples (`samples-*.bin`, ~52 MB/h) stay out by default (regenerable by re-import); they could be
  an option.
- Settings → "Backup": export (progress, size), import (summary of added/updated records, missing
  files). Tests: round trip with fake-indexeddb + in-memory AssetStore, forced ZIP64, corrupt input;
  `unzip -t` / `python3 -m zipfile -t` on a scratch output.

## 3. Device verification (ask the user to test, then record in CLAUDE.md "Measured iOS limits")

- 720p/1080p clips: the H.264 encode path is untested (Chromium has no AVC encoder). Check that
  the `clip` asset is H.264 at the right size; otherwise it fell back to `original`.
- MediaPipe cropper on iOS: load time, per-still time, crop quality. The fallback logs
  "pose model unavailable".
- OPFS writes from the capture worker (sync access handles).
- Gestures: grid pinch (2–4 columns) with `touch-action: pan-y`, viewer swipe, split/crossfade
  slider, crop editor pinch.
- Memory with long clips in the viewer; flipbook with many stills.
- Home Screen web app: does `persist()` get granted there?

## 4. Design polish (M5)

- Pass over all screens at 390 × 844: spacing, empty states, loading states (capture status in
  the feed), dark overlay consistency (viewer, flipbook, crop editor share styles → extract).
- Remove the duplicated date formatters (Home, SessionReview) in favour of `ui/format.ts`.
- Progression: show the clip quality badge, a "re-attach video" shortcut for holds without
  stills.

## 5. Smaller follow-ups

- Combine sessions: writes are separate IDB transactions (ordered so a repeat completes them).
  A multi-store transaction in `MetadataStore` would make it atomic.
- "Keep separate" for same-day sessions is stored in localStorage; move it to a session field
  if backups should carry it.
- `downsampleLuma` now uses up to 12×12 jittered taps per block (≈ 3–6 ms per 4K frame in V8).
  Re-measure on the iPhone. If the luma path loses the per-video benchmark to canvas, try
  step = block/8.

## Process

- Branch, PR, CI must pass (build + e2e). Squash-merge to main; deploy runs on main. Verify via
  `version.json`.
- In the container: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
