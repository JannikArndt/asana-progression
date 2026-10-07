# asana-progression — notes for Claude

Mobile-first static web app (iPhone, latest iOS Safari). Finds held yoga poses in practice videos,
lets the user label them, and shows each asana's progression over the years. Everything runs on
device; there is no backend. Live: https://jannikarndt.github.io/asana-progression/

The goal is comparing **asanas**. The Ashtanga primary series is only suggestion data
(a `SequenceTemplate`); never build the series structure into detection, storage or progression.

## Commands

```sh
npm run dev          # Vite dev server
npm run check        # svelte-check (TypeScript strict), fails on warnings
npm test             # Vitest unit tests (Node)
npm run test:coverage
npm run test:e2e     # Playwright smoke tests (builds + vite preview on :4173)
npm run build        # dist/ incl. version.json
npm run fixtures     # regenerate tests/fixtures/*.mp4|mov (needs ffmpeg with libx264/libx265/libvpx)
npm run icons        # regenerate public/icons/*.png
```

In the cloud container, Playwright must use the preinstalled browser:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
Playwright's Chromium decodes VP9/AV1 but not H.264/HEVC, so e2e fixtures are VP9.

## Architecture

Strictly decoupled modules. Each has `src/<module>/types.ts` (contract) and `index.ts` (public
API). `src/architecture.test.ts` enforces the allowed dependencies:

| Module | Responsibility | May import |
|---|---|---|
| `detection` | Pure streaming algorithm: pooled gray samples → m(t), C(t), candidates; params; analysis export format | nothing |
| `source` | File → metadata, fingerprint, gray samples on a 4 Hz grid, exact frame at t, packets for a range, HDR helpers | nothing (+ Mediabunny) |
| `model` | Shared data model (types only) + `newId` | `detection` types |
| `storage` | `MetadataStore` (IndexedDB, one repository per entity), OPFS sample files, quota helpers | `model` |
| `ui` | Screens, components, the processing worker; the **only** place modules are wired together | public APIs of all modules |
| `labeling`, `capture`, `crop`, `progression` | Milestones 2–4 (not created yet) | |

Imports into another module must go through its `index.ts` or `types.ts`.

### Processing pipeline (`src/ui/pipeline/`)

`analyze.worker.ts` (Web Worker): `openVideo(file)` → `source.sampleGray({hz, longSide, startIndex,
skipNonReference})` → `poolGray` → write pooled frame to OPFS (`SampleWriter`) + `Detector.push` →
every 5 s checkpoint the detector snapshot to IndexedDB (`jobs` store) → `Detector.finish` →
`Analysis` saved to IndexedDB, job deleted. Progress (C(t) chunks, sampler stats) is posted every
200 ms. `controller.svelte.ts` holds reactive state, the Screen Wake Lock, ETA, and retries a
failed decode up to 3× from the last checkpoint (after the page is visible again; the first retry
without non-reference skipping if nothing was decoded).

Resume after the tab was killed: `File` objects are **not** persisted (on iOS that would copy a
multi-GB file into IndexedDB). The user re-picks the file; the fingerprint matches the job and
the worker restores the detector snapshot and continues from `nextIndex`.

Re-analysis with new parameters reads the stored pooled frames (no decoding) — only
`sampleHz`, `sampleLongSide` and `pool` require re-importing.

### Storage layout

- IndexedDB `asana-progression` v1: `asanas`, `templates`, `sessions` (idx date, videoIds*),
  `videos` (idx fingerprint), `analyses` (key videoId), `holds` (idx asanaId, sessionId,
  videoId), `assets` (idx holdId), `jobs` (key videoId, idx fingerprint), `settings` (key/value).
- OPFS: `samples-<videoId>.bin` = consecutive pooled frames, `frameWidth × frameHeight` bytes
  each (80×45 = 3.6 KB per sample for 16:9 → ~52 MB per 60 min at 4 Hz). Written with sync
  access handles in the worker; read on the main thread via `getFile()`.

## Detection algorithm (validated by the user on a 7.6 min video)

1. Decode every frame (no keyframe-only sampling). Sample at 4 Hz on the grid t = k/4 s (sample
   k = first decoded frame with timestamp ≥ t − 1.5 ms) → grayscale, **long side** 160 px
   (portrait videos get 90×160, not 160×284; deliberate, same pixel budget) → 2×2 average pool.
   Downscaling is two-step (to 4× target, then target, `imageSmoothingQuality = 'high'`) to limit
   aliasing. Whole frame, no masks.
2. m(t) = mean |f(t) − f(t−1)|, median filter over 9 samples (centred, truncated at the edges).
3. C(t) = mean |mean(f[t−4 s, t)) − mean(f[t, t+4 s))| with Int32 running sums over a ring buffer
   of 2K+1 frames (K = 16). Edges use truncated windows of at least `edgeWindowMinS` = 1 s; C is
   NaN in the first/last second (NaN never counts as still).
4. still = C ≤ p55(C) (≤ instead of < so exact ties, e.g. noise-free synthetic video, work);
   join gaps < 1 s; keep runs ≥ 6 s. Single-still special case: if p99(C) ≤ 4 × p50(C) the video
   has no clear posture change → one candidate covering the whole video. (p99 rather than p95:
   videos with very long holds have < 5 % transition samples.)
5. Best frame = argmin m in the middle 80 % of the run (no breath-4 bias).
6. Clip window = 4 s window inside the hold with the lowest summed m.
7. Merge adjacent candidates whose best-frame tiny images are similar: mean |a − b| <
   `similarMergeFactor` (2) × max(threshold, m(bestA), m(bestB)), gap ≤ `similarMergeMaxGapS`
   (60 s). The m terms are the single-frame noise floor (C is a 4 s mean and much less noisy).
   The stiller best frame wins; merged-away best frames become `alternatesS`.
8. Every threshold is in `DetectionParams` and editable in the debug panel (Video → Debug).

Known limits (keep in mind when tuning): a global percentile can miss a whole hold whose sway
keeps C above p55 when there are only a few holds; noise-only holds fragment and rely on the
similar-merge; variants with near-identical silhouettes (e.g. Paschimottanasana A then B) can be
merged — the review step (M2) needs split.

Optimisation: `skipNonReference` drops packets that no other frame references (HEVC sub-layer
non-reference NAL types 0,2,…,14; H.264 `nal_ref_idc == 0`) before decoding. Default on; toggle
in Debug. Measured skip ratio is shown on the processing screen.

### Real-signal fixtures

Debug → "Export analysis JSON" writes `AnalysisExport` (signals, params, candidates, pre-merge
candidates and the tiny frames at every best frame). Drop files into
`src/detection/__fixtures__/real/`; `fixture.test.ts` replays them and, if a hand-written
`truth: [{startS, endS, name}]` array is added, checks that every true hold ≥ minHoldS is found.

## Source specifics

- Import via `<input type="file" accept="video/*" multiple>`.
- recordedAt: `com.apple.quicktime.creationdate` (keeps the UTC offset; parsed by hand because
  "+0200" is not portable for `Date`) → `mvhd` creation_time (can be the export time) →
  `file.lastModified`. Always editable later.
- Fingerprint: SHA-256(first 4 MiB ‖ last 4 MiB ‖ size ‖ duration ms).
- Re-import of a known fingerprint always asks: "Reuse labels and re-capture assets" /
  "Import as a new session" / "Cancel" (an unfinished job asks Resume / Start over / Cancel).
- Mediabunny reports HEVC codec strings as `hev1.…`; `resolveDecoderConfig` tries both `hev1`
  and `hvc1` with `VideoDecoder.isConfigSupported` and uses the first accepted one.
- HDR probe (Video → hold → "Full frame"): draws the exact frame into an sRGB and a Display-P3
  canvas, a software HLG→SDR tone map when the frame is readable as `I420P10`, and a native
  `<video>` for reference; reports pixel format, colour space and luma range; the user's verdict is
  saved into the diagnostics report.

## Dependencies (keep minimal)

| Package | Why |
|---|---|
| `svelte` | UI framework (compiled, small runtime). Required by the spec. |
| `mediabunny` | MP4/MOV demuxing with lazy reads from a `File` (60–90 min 4K files are 10–40 GB), packet access, WebCodecs decoder configs, and MP4 muxing for clip capture (M3) in one tree-shakable, dependency-free TypeScript library. Chosen over mp4box.js, whose push-style `appendBuffer`/`onSamples` API needs manual buffer feeding and has no MP4 writer of comparable ergonomics. |
| dev: `vite`, `@sveltejs/vite-plugin-svelte` | Build. |
| dev: `typescript` 6.x, `svelte-check` | Type checking (svelte-check does not support TS 7 yet). |
| dev: `vitest`, `@vitest/coverage-v8` | Unit tests + coverage thresholds (detection ≥ 98 % lines, storage ≥ 95 %). |
| dev: `fake-indexeddb` | IndexedDB in Node for storage tests. |
| dev: `@playwright/test` | Smoke tests in Chromium. |

## Deployment

`.github/workflows/deploy.yml`: `build` (npm ci → check → test → build → configure-pages →
upload-pages-artifact) and `e2e` (Playwright) run on every push/PR; `deploy` (deploy-pages) runs
on `main` only and needs both. Vite `base: '/asana-progression/'`.

`version.json` (`{version, builtAt}`, version = short SHA + build time) is emitted by the build.
On `visibilitychange` → visible the app fetches it with `cache: 'no-store'`; a new version shows a
subtle "Update available" pill. Reload happens only when quiet (no processing; later: no unsaved
labels — register via `updates.addQuietCheck`): when the page is hidden, or on tap.

## Design

Tokens in `src/ui/styles/tokens.css` (colours, spacing, radii, type scale, motion, safe areas);
use them everywhere, including canvas drawing (TimelineGraph reads them via
`getComputedStyle`). Calm and light: off-white `--color-bg`, near-black text, one muted sage
accent, system font, hairlines, no heavy shadows, touch targets ≥ 44 px.

Timeline graph (`src/ui/components/TimelineGraph.svelte`, maths in `timeline.ts`): canvas,
min/max envelope per pixel when zoomed out, pinch zoom, inertial horizontal pan
(`touch-action: pan-y` keeps vertical page scroll native), tap a span to select, selection from
the list scrolls the graph. Labeled spans = accent tint + name (horizontal or rotated), open =
neutral grey, dismissed = hatched.

## Measured iOS limits

Fill in from the user's device reports (Settings → "Copy diagnostics report", Video → Debug →
"Copy diagnostics").

| Topic | Expectation / source | Measured on device |
|---|---|---|
| File handover from Photos | Photos picker may compress/transcode unless the picker's Options → Format is set to "Current" (iOS 17: "Options", iOS 18: control icon) — https://support.echo360.com/hc/en-us/articles/38604331326093-Troubleshooting-iOS-Uploads ; picking the same video via Files uploads it unchanged — https://developer.apple.com/forums/thread/731042 | pending |
| File handover from Files | Original file | pending |
| WebCodecs video decode | Available since Safari 16.4 — https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ ; HEVC Main 10 support to be verified on device (Settings → Video decoding) | pending |
| Decode speed (60 min 4K60 HEVC) | unknown | pending |
| Memory peak | Safari exposes no JS memory API; use Web Inspector → Timelines → Memory | pending |
| OPFS quota | Safari 17+: browser apps up to 60 % of disk per origin, Home Screen web apps the same — https://webkit.org/blog/14403/updates-to-storage-policy/ | pending (Settings → Measure) |
| Persistent storage | Granted by heuristics, e.g. Home Screen web app — same source | pending |
| HLG → canvas | unknown; HDR probe compares sRGB/P3 canvas, software tone map and `<video>` | pending |
| Screen Wake Lock | Since Safari 16.4 — https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ | pending |

## Milestones

1. **Spike** (this): source + detection + live timeline graph + debug panel, deployed. ✅ built;
   waiting for on-device measurements.
2. Data model + storage + session review / labeling with suggestions.
3. Capture (still + clip) + auto-crop with manual override.
4. Progression view.
5. Catalog/template editor, backup, re-import flow, design polish.
