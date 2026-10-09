# Plan for the next session

State on main: milestones 1–5 done (M5: catalog/template editor, re-import with re-capture,
backup export/import, design polish). Open: the failed-video report and device verification. Read CLAUDE.md first; it is the source of truth for
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

## 2. ~~Backup export/import~~ — done (see CLAUDE.md "Backup")

## 3. Device verification (ask the user to test, then record in CLAUDE.md "Measured iOS limits")

- 720p/1080p clips: the H.264 encode path is untested (Chromium has no AVC encoder). Check that
  the `clip` asset is H.264 at the right size; otherwise it fell back to `original`.
- MediaPipe cropper on iOS: load time, per-still time, crop quality. The fallback logs
  "pose model unavailable".
- OPFS writes from the capture worker (sync access handles).
- Gestures: grid pinch (2–4 columns) with `touch-action: pan-y`, viewer swipe, split/crossfade
  slider, crop editor pinch.
- Memory with long clips in the viewer; flipbook with many stills.
- ~~Home Screen web app: does `persist()` get granted there?~~ Yes (2026-10-09).
- Backup on iOS: "Save" (`<a download>` of a Blob made of OPFS files) and "Share…" → Save to
  Files; import a multi-GB backup from Files (memory, time). Untested on device.

## 4. ~~Design polish~~ — done: shared `.overlay` frame (viewer, flipbook, crop editor), one
date formatter (`ui/format.ts`), clip quality badge and re-attach shortcut on the asana page, filter
bar no longer wraps labels. Next pass needs the user's eye on the device.

## 5. Smaller follow-ups

- ~~Combine sessions atomic~~: `MetadataStore.batch` (one transaction).
- ~~"Keep separate" in localStorage~~: now `Session.keepSeparate`.
- ~~Re-measure `downsampleLuma` on the iPhone~~: luma still wins clearly (2 vs 31 ms at 4K).
- Detection on long practices: ask the user to label the outdoor primary-series video fully and
  re-export (exports now carry `meta.labels`) to replace the by-eye truth in
  `ashtanga-primary-outdoor.json`. Padangusthasana + Padahastasana come out as one 49 s run there.

## Process

- Branch, PR, CI must pass (build + e2e). Squash-merge to main; deploy runs on main. Verify via
  `version.json`.
- In the container: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
