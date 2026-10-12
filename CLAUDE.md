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
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`
(`PW_PORT=<port>` runs the preview server on another port than 4173, e.g. for parallel checkouts).
Playwright's Chromium decodes VP9/AV1 but not H.264/HEVC, so e2e fixtures are VP9.

## Architecture

Strictly decoupled modules. Each has `src/<module>/types.ts` (contract) and `index.ts` (public
API). `src/architecture.test.ts` enforces the allowed dependencies:

| Module | Responsibility | May import |
|---|---|---|
| `detection` | Pure streaming algorithm: pooled gray samples → m(t), C(t), candidates; params; analysis export format | nothing |
| `source` | File → metadata, fingerprint, gray samples on a 4 Hz grid, exact frame at t, packets for a range, HDR helpers | nothing (+ Mediabunny) |
| `model` | Shared data model (types), `newId`, catalog seed + Primary series template | `detection` types |
| `storage` | `MetadataStore` (IndexedDB, one repository per entity), OPFS sample files, quota helpers | `model` |
| `labeling` | Suggestion engine; review edits on candidates (merge, split, add missed, nudge, reconcile); catalog search | `model`, `detection` (best-frame helpers on signals) |
| `capture` | Still (exact frame → JPEG q 0.9 + 512 px thumb + preview for the cropper) and clip (720p/1080p H.264 re-encode via WebCodecs, or `original` = stream copy snapped to key frames; falls back to `original` when AVC encoding is unavailable) | `source`, `model` |
| `crop` | `Cropper` interface; MediaPipe Pose Landmarker (lite, CPU, lazy, Cache Storage `mediapipe-pose-v1` for offline) → body box + coarse posture class; `nullCropper` fallback | `model` |
| `progression` | Views over holds + assets: items per asana (oldest first), display crop, tile aspect, grid density, swipe, flipbook timing | `model` |
| `ui` | Screens, components, workers; the **only** place modules are wired together | public APIs of all modules |

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

### Labeling (milestone 2)

- Catalog-first: holds reference asanas; a `SequenceTemplate` only drives suggestions. Seeded on
  first run (`catalogVersion` setting, now 4): 64 asanas (22 sided, each with a `group` and,
  except Adho Mukha Svanasana, a coarse `posture` class) and "Primary series" (87 entries; reps:
  Adho Mukha Svanasana ×8 for the sun salutations, 5 A + 3 B, Navasana ×5, Urdhva Dhanurasana ×3;
  sided asanas R then L; Utthita Hasta Padangusthasana A/B/C R then A/B/C L and Supta
  Padangusthasana A/B R then A/B L; Paschimottanasana A again after Urdhva Dhanurasana;
  Virabhadrasana B is R then L like everything else — edit in M5 if the practice differs).
  Upgrades only add what a version introduced (`SEED_ADDED`, never re-adding deleted asanas),
  prepend the sun salutations to an existing Primary series once (v2), turn consecutive
  identical entries into `reps` (v3) and split Supta Padangusthasana into A (leg up, keeps the id
  `supta-padangusthasana`; renamed only while its name is unchanged) and B (leg to the side) in
  every template whose R entry is directly followed by L (`withSuptaPadangusthasanaB`, v4; labeled
  holds re-align via `alignToTemplate`); a deleted template stays deleted. Seed rows may carry an
  explicit `id` for such renames.
- **Variant families**: lettered variants ("Janu Sirsasana A/B/C", names ending in a space + A–F,
  same base and `group`) stay separate asanas — A is only ever compared with A — but are shown as
  one asana with letters, like R/L (`model.variantOf`, `asanaFamilies`, derived from the names, so
  user-created "Foo A"/"Foo B" form a family and renames join/leave one): one row on Home, an
  A | B segmented control on the progression page, base name + letter rows in the label picker.
  Labels, suggestions, review cards and the viewer keep full names.
- **Reps**: consecutive holds of the same asana and side in a session are reps 1…n of one run
  (`progression.holdReps`, derived, never stored), e.g. the 1st and the 5th Navasana differ a lot.
  A template entry's `reps` is the usual count (editable in the template editor), not a limit:
  suggestions keep offering the entry until it has its reps, then still offer "another rep"
  (`reason: 'rep'`) behind the next entry; a label equal to the previous hold's becomes another
  rep of the same entry (no merge prompt; "Merge with previous" stays in the card menu).
  Progression filters All reps / First / Last (first vs first across days) and shows "rep 2/5".
- **Split into k**: `labeling.splitInto` cuts a candidate into k holds at the k most prominent
  valleys of C(t) inside it (topographic prominence, cut at the biggest change between valleys;
  halves the longest part if there are fewer). With k known no still threshold is needed — on the
  outdoor fixture, 18:11–20:03 with k = 6 yields the six UHP valleys although the global threshold
  marks the whole span as still. `expectedHolds` derives k from the template (slots between the
  labeled neighbours, incl. reps, minus other open cards); the card shows "Template expects k
  holds here · Split", the menu has "Split into several…".
- Sessions: created at import (one per video; files of one batch recorded on the same day share
  a session). The template is chosen per session at import from all templates + None (default
  Primary series, else the first template; "None" for clips < 5 min) and can be switched on the
  review screen (a "Template" row opening the same list). Milestone-1 videos without a session get
  one on startup (`AppState.migrate`). Length = `sessionSpanS`: first video start to last video
  end (pauses count), only when every `recordedAt` parses and the span is ≥ the sum of durations
  − 1 s and ≤ sum + 4 h; otherwise the sum (export times, file dates).
- Place: `Session.location = {name?, lat?, lon?}`. A new session takes the coordinates of its
  first video that has some (`VideoMeta.location`), named after the nearest named session within
  300 m (`placeNameNear`); a joining video fills in missing coordinates. Videos imported before
  locations were read lack the `location` key in `meta`: `AppState.attachFile` reads it from the
  attached file once (fire and forget) and places the session. The review header's location row
  opens a sheet (name + chips from `placeNames`, nearest first); a name also goes to unnamed
  sessions within 300 m that have coordinates (`unnamedNear`). Diagnostics and analysis exports
  leave the coordinates out (`withoutLocation`, `videoForReport`).
- Review state lives in `Analysis.candidates` (`ReviewCandidate`: status, `holdId`, `origin`);
  labels live in `Hold` records. Every action writes immediately — there is never unsaved
  labeling state.
- Suggestions (`labeling/suggest.ts`, run in `ui/workers/suggest.worker.ts`): template order,
  each entry for its `reps` (see Reps), R before L (template order), skipping allowed. Start after the
  last confirmed entry; consecutive open cards are projected onto consecutive entries; entries
  before the next confirmed entry are preferred. If a card's optional posture class contradicts
  the next entry, look ahead up to 5 entries. Top 3. Without a template (or once it is
  exhausted): frecency (exp(−age/45 d)) plus a boost for what usually follows the previous
  asana in past sessions.
- Re-running detection reconciles: labeled holds and manual candidates are kept, dismissals are
  carried over to overlapping new candidates.
- Screens: Home (tabs Asanas / Sessions), session review (`#/session/<id>`: timeline, cards with
  one-tap confirm, picker with search incl. initials like "uhp", ••• menu with a scrollable strip of
  tiny frames across the hold (`previewTimes`: one per 6 s, 4–24) to spot a posture change, actions:
  choose frame, split,
  split into several, merge with previous (a label always survives: `mergeCandidates` is labeled if
  either side is, "Not a pose" only if both are; "Not a pose" candidates between the two are
  absorbed), not a pose (the card disappears into its gap row), full-resolution frame, add missed hold),
  the session's video files (`#/session/<id>/videos`, `SessionVideos.svelte`, linked "N videos ›"
  top right of the review: order with ↑/↓ or "Sort by recording time" → `SessionReview.setVideoOrder`,
  recording time (`formatRecordedAt`, own UTC offset) and its source, place on the session timeline,
  "Select file", Debug panel per video, "Copy diagnostics of all videos" via `videoDiagnostics`),
  asana progression
  (`#/asana/<id>`). `#/video/<id>` redirects to the session. Splitting a practice into several
  videos is a technical matter: the review shows asanas only, file details live on the videos page.
- Uncovered gaps (`session-data.coverageGaps`): between the cards of a video (and before the first /
  after the last) a quiet row "1 min 7 s not covered · + Add holds" marks stretches covered by no
  card. "Not a pose" (dismissed) candidates are never cards: they count as uncovered, and a gap
  holding one is always listed, however short ("· 1 skipped"). Nothing separates the end of one
  video from the start of the next on the session timeline, so stretches meeting at a boundary (and
  a whole video without cards) are **one** row with several parts (`coverageRows` → `GapPart[]`,
  listed when the total reaches the smaller threshold of its videos; a video without analysis ends
  a gap); its sheet shows frames from every part, Find runs per part, and "Add a hold by hand…"
  asks which part. Threshold
  `gapThreshold`: always from 30 s, down to 10 s when the gap is ≥ 1.5 × the video's median gap
  between candidates (the outdoor primary series has a 19 s median from vinyasas; 10 s would put a
  row after most cards, while a missed hold leaves two transitions plus the hold). Tapping opens a
  sheet with the gap's tiny frames and: **Find holds here** (`labeling.detectInRange`: the detector's
  candidate step on the stored m/C of just that stretch, with the stretch's own p55 threshold,
  single-still off, similar-merge with the stored analysis frames; new cards are `origin: 'manual'`
  so a full re-run keeps them; spans mostly overlapping a "Not a pose" one are not offered again —
  on both real fixtures it finds every labeled hold when the stretch between its labeled neighbours
  is analysed, `detect-range.test.ts`), **Add a hold by hand…** (frame scrubber limited to the gap,
  starting in its middle; `missedCandidate(atS, sig, bounds)` keeps the new span inside the gap) and
  **Show the skipped hold(s)** (`restoreIn`). "+ Add missed hold" (whole video) clamps to the free stretch
  between the neighbours (`freeSpanAround`) unless the time lies inside a candidate.
- Labeled holds keep `templateEntryIndex`; `alignToTemplate` re-maps it whenever the session's
  template was switched or edited, so suggestions never follow stale indices.

### Capture and crop (milestone 3)

- `ui/state/capture.svelte.ts` (`CaptureQueue`) captures in `ui/pipeline/capture.worker.ts`, one
  video at a time, for every labeled hold whose still/thumb/clip is missing or stale
  (`capture-plan.ts`: best frame or clip window changed, clip quality changed). Needs the video
  file picked in this page session; otherwise the hold shows "re-attach" (review banner checks the
  fingerprint).
- Files live in OPFS under `assets/<assetId>.<ext>` (`OpfsAssetStore`, written in the worker with
  sync access handles); records in the `assets` store. Replaced assets are deleted.
- The cropper runs on the 640 px preview; `crop.auto` = body box + padding. BlazePose has no
  crown or fingertip landmarks, so the box is grown by a head circle (1.6 × the face-landmark
  spread, at least 0.35 torso lengths) and by the hand landmarks extended 0.6 × from the wrist,
  then padded 0.15 × its longer side in pixels (at least 2 % of the image height); see
  `BOX_DEFAULTS`. Crops are display metadata only (`manual ?? auto ?? full frame`); `CropEditor`
  writes `crop.manual`. `crop.autoVersion` = `CROP_VERSION` of the box; holds with an older
  version are cropped again from their stored still in the capture worker (`recrop`, no video
  file needed) on startup and whenever capture is requested. Bump `CROP_VERSION` when the box
  changes.
- `CropEditor`: aspect presets Free, 2:3, 3:4, 4:5, 1:1, 3:2, 16:9 (portrait first). The frame has
  corner and edge handles (44 px hit areas): Free changes its shape, a preset keeps the aspect;
  on release the frame grows back to fill the stage and the image zooms with it (like Photos).
  Pinch/drag moves the image. Geometry (`resizeFrame`, `fitFrame`, `cropWithAspect`) in
  `ui/state/crop-frame.ts` (tested). Escape cancels.
- Pose overlay: `capture.pose(still)` sends a `pose` request to the capture worker (beside any
  running capture; own job id and listener) → `PoseDetection` incl. the 33 landmarks (never
  stored; cached per still storage key for the page's lifetime). `crop/overlay.ts` maps landmarks
  and the box into the displayed crop (tested); `PoseOverlay.svelte` draws skeleton, dots (dimmed
  below visibility 0.3), dashed body box; the posture class is a chip. Null cropper → "Pose model off".
- ReviewCard: a tap on the thumbnail selects the hold and opens a small anchored menu (Choose
  frame, Edit crop when a still exists, Full-resolution frame when the file is attached); entries
  come from optional callback props.
- MediaPipe wasm loader/binary are emitted by the `mediapipe-wasm` Vite plugin at
  `<base>mediapipe/`, the model is `public/models/pose_landmarker_lite.task` (Apache-2.0).
  Debug switch: `localStorage['asana.debug.capture'] = '{"cropper":"none"}'` (used by e2e).
- Safari tone-maps HLG in the decoder, so stills are SDR; only `original` clips keep HDR.

### Progression (milestone 4)

`#/asana/<id>` (`screens/AsanaProgression.svelte`): for a variant family the title is the base
name with a letter control (A | B, hold counts) under it; a letter replaces the route with that
member's page (side and rep filters carried over), so everything below is one letter only. Feed (newest first, date, side, note) or grid
(2–4 columns, pinch or ctrl+wheel; tiles share the median crop aspect), side filter, rep filter
(All reps / First / Last, when the asana has runs of reps), viewer
(`HoldViewer`: swipe through all holds oldest → newest; a tap on the image toggles a translucent
action bar — Edit crop, Choose frame, Play clip, Pose, Compare — that hides after 4 s; nothing
opens directly from a tap; a tap beside the image, a pull down or Escape closes; axis decided after
10 px in `viewer-gestures.ts`, tested). Compare (formerly "pin", same localStorage key
`asana.pinned.<id>`) marks a reference hold: swiping to another day shows split slider or
crossfade with both dates and a Stop button; the feed marks the reference. Choose frame opens
`FrameScrubber` above the viewer and `hold-actions.chooseBestFrame` updates candidate + hold and
re-captures the still (no file → re-attach row in the viewer). Flipbook (`Flipbook`: stills in date order,
0.5–12 per second, preloads ahead). Holds without a still fall back to the tiny analysis frame.

### Backup (milestone 5)

Settings → Backup. `storage/zip.ts` is a dependency-free STORE-only ZIP writer/reader (streaming
CRC-32, ZIP64 only when needed; the export Blob references the stored files, nothing is copied).
`storage/backup.ts`: `backup.json` = all repositories except `jobs` plus the non-device settings
(`isDeviceSetting`: persist flags, `catalogVersion`, `diag.*`, `backup.*`); typed arrays are
`{$typed, b64}`; asset files under their storage keys; analysis frames (`samples-*.bin`) only when
"Include analysis frames" is checked. Import (`ui/pipeline/backup.worker.ts`, OPFS needs sync
handles on iOS) plans first (added / replaced / unchanged per store, shown for confirmation),
merges by key (the backup's version wins; a different local asset for the same hold + kind is
kept), writes files first with CRC check, then all records in one `MetadataStore.batch`
transaction, then reloads the app. Export downloads via `<a download>` after a fresh tap, or the
share sheet ("Save to Files"). "Keep separate" for same-day sessions is `Session.keepSeparate`
(migrated from localStorage) so backups carry it.

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
   join gaps < 1 s; keep runs ≥ 6 s. Single-still special case: if the video is ≤ 300 s and
   p99(C) ≤ 4 × p50(C) it has no clear posture change → one candidate covering the whole video.
   (p99 rather than p95: videos with very long holds have < 5 % transition samples. The length
   limit: a 67 min practice that is mostly movement had p99/p50 = 3.0 and became one candidate.)
5. Best frame = argmin m in the middle 80 % of the run (no breath-4 bias).
6. Clip window = 4 s window inside the hold with the lowest summed m.
7. Merge adjacent candidates whose best-frame tiny images are similar: mean |a − b| <
   `similarMergeFactor` (2) × max(threshold, m(bestA), m(bestB)), gap ≤ `similarMergeMaxGapS`
   (60 s). The m terms are the single-frame noise floor (C is a 4 s mean and much less noisy).
   The stiller best frame wins; merged-away best frames become `alternatesS`.
   Only fragments merge: the highest m between the two must be ≤ `similarMergeMotion` (1.1) ×
   p90 of m inside them. Leaving a pose and coming back (reps: Navasana ×5, Urdhva Dhanurasana ×3)
   moves more than the sway inside a hold, but the reps look alike — in the labeled outdoor
   practice every similar-merge (6) joined reps or Padmasana/Utpluthih, while in the finishing clip
   the two merges joined a noise-split Sirsasana A (gap motion 0.95 and 0.6 × p90).
   Cap: the merge distance is at most `similarMergeRelative` (0.45) × the median best-frame
   distance of adjacent candidates with a clear change between them (C peak ≥ 1.5 × threshold;
   needs ≥ 5 such pairs). That median says how different two poses look in this video. Without the
   cap, an outdoor practice (small body, threshold inflated by movement: 3.1 vs. m ≈ 0.2) merged
   Trikonasana R/L, all sun-salutation down dogs, UHP and Virabhadrasana A/B.
8. Every threshold is in `DetectionParams` and editable in the debug panel (Video → Debug).

Known limits (keep in mind when tuning): a global percentile can miss a whole hold whose sway
keeps C above p55 when there are only a few holds; noise-only holds fragment and rely on the
similar-merge; variants with near-identical silhouettes (e.g. Paschimottanasana A then B) can be
merged — the review step (M2) needs split.

Real data: `src/detection/__fixtures__/real/ashtanga-primary-outdoor.json` is a 67.6 min outdoor
primary series (1080×1120 HEVC HLG), fully labeled by the user: truth = the 93 labeled holds (two
names corrected by eye; Supta Padangusthasana split into A/B per side along the detector's spans), params/candidates recomputed with the defaults. Nothing is missed;
holds with near-identical silhouettes and little movement between them (Padangusthasana +
Padahastasana, UHP B + C, Paschimottanasana A/B/C, Baddha Konasana A/B, Sarvangasana + Halasana)
form one still run and need Split; some asanas are two candidates because the posture changes
inside them (Kurmasana, Bhujapidasana, …) and need
Merge. Hence `truthMinOwn` (80 of 93 own candidates) is the regression floor there. `sarvangasana-finishing.json` is the user's 7.6 min
finishing-sequence clip (the validation video). All 9 holds are found; their best frames were checked
by eye on full-resolution frames (the long Sirsasana A is split in 3 and merged back). The truth
spans are the detector's own spans (named, not hand-segmented); the fixture test checks that each
named hold is found and that its best frame stays within 1.5 s of the confirmed `bestS`.

Optimisation: `skipNonReference` drops packets that no other frame references (HEVC sub-layer
non-reference NAL types 0,2,…,14; H.264 `nal_ref_idc == 0`) before decoding. Default on; toggle
in Debug. Measured skip ratio is shown on the processing screen.

### Real-signal fixtures

Debug → "Export analysis JSON" writes `AnalysisExport` (signals, params, candidates, pre-merge
candidates and the tiny frames at every best frame). Drop files into
`src/detection/__fixtures__/real/`; `fixture.test.ts` replays them and, if a hand-written
`truth: [{startS, endS, name, bestS?}]` array is added, checks with the **current defaults** that
every true hold ≥ minHoldS is found as its own candidate (with `truthMinOwn`: none missed and at
least that many own). Exports carry the labeled holds in `meta.labels` (name incl. side,
start/end/best) as a starting point for `truth`; their `candidates` are the review state, so
recompute candidates/preMerge with the defaults before committing a fixture.

## Source specifics

- Import via `<input type="file" accept="video/*" multiple>`.
- recordedAt: `com.apple.quicktime.creationdate` (keeps the UTC offset; parsed by hand because
  "+0200" is not portable for `Date`) → `mvhd` creation_time (can be the export time) →
  `file.lastModified`. Always editable later.
- location: ISO 6709 (`parseIso6709`: decimal degrees or DDMM/DDMMSS, optional altitude and
  `CRS…` suffix) from `com.apple.quicktime.location.ISO6709` (keys/ilst) → udta `©xyz`; null
  when absent. Fixtures `location-keys.mov`, `location-udta.mov`.
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
| `@mediapipe/tasks-vision` | Pose landmarks for the automatic crop (Apache-2.0). Loaded lazily in the capture worker only; wasm + model self-hosted and cached for offline use. |
| dev: `vite`, `@sveltejs/vite-plugin-svelte` | Build. |
| dev: `typescript` 6.x, `svelte-check` | Type checking (svelte-check does not support TS 7 yet). |
| dev: `vitest`, `@vitest/coverage-v8` | Unit tests + coverage thresholds (detection, labeling ≥ 98 % lines; storage ≥ 95 %). |
| dev: `fake-indexeddb` | IndexedDB in Node for storage tests. |
| dev: `@playwright/test` | Smoke tests in Chromium. |

## Deployment

`.github/workflows/deploy.yml`: `build` (npm ci → check → test → build → configure-pages →
upload-pages-artifact) and `e2e` (Playwright) run on every push/PR; `deploy` (deploy-pages) runs
on `main` only and needs both. Vite `base: '/asana-progression/'`.

`version.json` (`{version, builtAt}`, version = short SHA + build time) is emitted by the build.
On `visibilitychange` → visible the app fetches it with `cache: 'no-store'`; a new version shows a
subtle "Update available" pill. Reload happens only when quiet (no analysis, capture, backup
export/import or prepared backup file — register via `updates.addQuietCheck`; labels are never
unsaved): when the page is hidden, or on tap.

## Design

Tokens in `src/ui/styles/tokens.css` (colours, spacing, radii, type scale, motion, safe areas);
use them everywhere, including canvas drawing (TimelineGraph reads them via
`getComputedStyle`). Calm and light: off-white `--color-bg`, near-black text, one muted sage
accent, system font, hairlines, no heavy shadows, touch targets ≥ 44 px.

Sheets (`components/Sheet.svelte`) are pinned to `visualViewport` (iOS keyboard: the layout
viewport extends behind it); search sheets pass `fill` to keep their height while results shrink.
Every bottom surface is a `Sheet`, including `dialog.ask` questions and the review ••• menu
(`Dialog.svelte`; `layer="dialog"` stacks above sheets and overlays). One anatomy: grabber, then a
header row — dismiss **top-left** (a round ✕ "Close"; "Cancel" when the sheet has a confirming
`action`, which sits top-right, e.g. Save / Split here, `action.form` submits a form), title
centred. Never a close/cancel button at the bottom; full-screen overlays follow the same rule (✕ or
Cancel top-left). Dismiss = cancel (drafts are dropped, never saved silently): ✕/Cancel, a tap on
the backdrop, Escape, or swiping down. A dialog's `cancel` option becomes the ✕ (`dismissOf`: a
single-option notice dismisses with that option; otherwise it is not dismissible).
Swipe (`sheet-gesture.ts`, unit-tested): grabber/header always drag (`touch-action: none`); the
content drags only from scroll top, downwards (pointer events + a non-passive `touchmove` that
stops native scrolling once the sheet drags); sliders and `[data-sheet-no-drag]` never; mouse only
on the header. Slop 6 px, vertical only; the sheet follows the finger (rubber band upwards),
dismisses past 30 % of its height or on a flick ≥ 0.5 px/ms (upward flick keeps it), otherwise
springs back; the backdrop fades with the offset. `prefers-reduced-motion`: no slide animations.
Focus moves into the sheet, Tab is trapped, focus returns on close.

Asanas list (Home): one row per variant family (base name; `session-data.familyStats` joins the
members). The preview is the newest hold that has a captured image (thumb, else still),
filling a square via `progression.fillCrop` around the display crop; the gray analysis frame only
when nothing is captured. The line reads "N holds", plus "· M days" when they span several days,
plus the letters of a family ("· A B", letters without holds fainter). A tap opens the letter
with the newest hold.

Sessions list (Home): a 56 px square thumbnail of the captured image (thumb, else still) of the
hold nearest the middle of the session (`sessionPreview`), the **whole frame** cover-cropped
(`fillCrop(null, …)`: place and light identify a session, not the body); else the analysis frame
in the middle of the longest analysed video (`sessionTinyFrame`). Lines: date; "span · N labeled
· M open · template"; place (name, else coordinates) and note, when present.

Timeline graph (`src/ui/components/TimelineGraph.svelte`, maths in `timeline.ts`): canvas,
min/max envelope per pixel when zoomed out, pinch zoom, inertial horizontal pan
(`touch-action: pan-y` keeps vertical page scroll native), tap a span to select, selection from
the list scrolls the graph. Labeled spans = accent tint + name (horizontal if it fits, otherwise
rotated wherever it keeps 12 px from the previous rotated label), open = neutral grey, dismissed =
hatched. Optional `range` (show a window instead of the whole video; a new object moves there,
animated unless `animate: false`) and `onview` (visible range on every view change).

Session review timeline (`SessionReview.svelte`, maths in `session-timeline.ts`): **one timeline
for the whole session**: the videos back to back in session order (`videoOffsets`; pauses left out,
the order is the user's), C(t) joined with each video divided by its own threshold
(`combinedSignal`, threshold line at 1, NaN between videos), thin lines at video boundaries
(`TimelineGraph` `boundaries`), cards numbered through and showing session time (`ReviewCard`
`offsetS`); gap rows join across video boundaries; "+ Add missed hold" asks which part with several videos. One
sticky header (`top: var(--safe-top)`, solid background, hairline once stuck; the status-bar area is
covered by a fixed strip) with
1. the overview (`TimelineOverview.svelte`, DOM, 36 px): the whole session, runs of consecutive
   labeled holds with the same catalog `group` as labeled segments (`groupSegments`; open and
   dismissed cards do not break a run; short names "Sun", "Backbends"), open candidates as grey
   ticks, and a rectangle for the range the detail graph shows. Tap or drag moves the window; the
   end of the gesture scrolls the list to the first card ending after that time.
2. the detail graph (136 px, collapsible with the chevron; collapsed = only the overview stays
   sticky; the chevron `›` turns to point down while expanded — it is `inline-block`, a transform
   does not apply to an inline span): a 10 min window (`DETAIL_WINDOW_S`; sessions ≤ 12 min are
   shown whole).
The window follows the list: on scroll (rAF-throttled, layout reads only) the card right below
the header (binary search over the card rects, `firstBelow`) defines the current time; the window
re-centres on it only when it leaves the middle 50 % (`followWindow`), so it moves in calm steps.
Programmatic smooth scrolls (graph tap, overview tap) pause following until the scrolling stops.
Card scrolling (`scrollToCard`) keeps cards below the sticky header.

## Measured iOS limits

Fill in from the user's device reports (Settings → "Copy diagnostics report", Video → Debug →
"Copy diagnostics").

| Topic | Expectation / source | Measured on device (iPhone 15, iOS 18.7, Safari tab, 2026-10-07) |
|---|---|---|
| File handover from Photos | Photos picker may compress/transcode unless the picker's Options → Format is set to "Current" (iOS 17: "Options", iOS 18: control icon) — https://support.echo360.com/hc/en-us/articles/38604331326093-Troubleshooting-iOS-Uploads ; picking the same video via Files uploads it unchanged — https://developer.apple.com/forums/thread/731042 | Cropped exports arrived as HEVC Main 10 HLG `video/mp4` with Apple metadata (make/model/software, `com.apple.quicktime.creationdate`); `mvhd` creation_time = export time. Photos vs Files comparison still pending. |
| File handover from Files | Original file | pending |
| WebCodecs video decode | Available since Safari 16.4 — https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ | HEVC Main 10 4K supported (`hvc1` and `hev1`), also H.264 and VP9. Decoded frames are `NV12`. |
| Decode speed | — | 4.1–4.5× real time for 3040×1960 @ 59.94 HEVC Main 10 with non-reference skipping (≈ 50 % of packets skipped). Frame → gray via canvas took ≈ 39 ms per sample = 65 % of wall time → added the luma-plane path (`source/convert.ts`), chosen per video by a first-frame benchmark. With the luma path (2026-10-09, 12×12 jittered taps): **8.8×** for that video; 36–38× for 1080×1120 @ 30/60 fps HEVC Main 10. Benchmark luma vs canvas per frame: 2 vs 31 ms (4K), 4–5 vs 10–58 ms (1080p); ≈ 2.5–4.7 ms per sample incl. copy. |
| Memory peak | Safari exposes no JS memory API; use Web Inspector → Timelines → Memory | not measured |
| OPFS quota | Safari 17+: browser apps up to 60 % of disk per origin, Home Screen web apps the same — https://webkit.org/blog/14403/updates-to-storage-policy/ | `estimate().quota` 41.2 GB. Writing: first 1 GB in ≈ 1 s, 5 GB in 81 s (≈ 62 MB/s); Home Screen app: 2 GB in 23.6 s (≈ 85 MB/s). Safari's `usage` estimate did **not** drop after the test files were deleted (OPFS listing was back to 9.8 MB) — Settings shows the real file list and removes leftovers. |
| Persistent storage | Granted by heuristics, e.g. Home Screen web app — same source | `persist()` → false in a Safari tab; **granted** in the Home Screen web app (standalone, 2026-10-09). |
| HLG → canvas | — | Safari tone-maps HLG to SDR inside the decoder: frames arrive as 8-bit `NV12`, BT.709 / sRGB transfer, full range. sRGB and Display-P3 canvases are identical (luma 3–236) and look SDR, not HDR. Stills are therefore SDR JPEGs; the "original" clip quality (stream copy) keeps HDR for playback. |
| Screen Wake Lock | Since Safari 16.4 — https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ | available |

## Milestones

1. **Spike**: source + detection + live timeline graph + debug panel, deployed. ✅ measured on
   device (see above).
2. **Data model + storage + session review / labeling with suggestions.** ✅
3. **Capture (still + clip) + auto-crop with manual override.** ✅
4. **Progression view.** ✅
5. Catalog/template editor ✅ (`#/catalog`, `#/template/<id>`; asanas: add/edit/delete when
   unused; templates: new, rename, insert/move/remove entries, duplicate, delete). Re-import
   reuses labels and re-captures ✅. Backup export/import ✅. Design polish ✅ (shared overlay
   frame, one date formatter, clip quality badge, re-attach from the asana page). Still open:
   on-device verification.

Open (needs the user):

- A failed video: reproduce from its diagnostics report (codec string, `decoderSupport`, sampler
  stats, error stage). A detection miss becomes a fixture with `truth`, tuned via `DetectionParams`.
- On the iPhone: 720p/1080p clips are H.264 at the right size (Chromium has no AVC encoder, so
  untested); MediaPipe load/per-still time and crop quality; gestures (grid pinch, viewer swipe,
  split/crossfade slider, crop pinch); memory with long clips and big flipbooks; backup Save,
  Share → Save to Files and importing a multi-GB backup. Record results in "Measured iOS limits".
- Check the new automatic crops on the iPhone (re-cropped from the stills after the update).
