# Research report — hold finding, asana naming, auto-crop

Data: the research export and one detection-lab run with the default grid (`research/data/`,
app version `674b241`, 2026-10-13). Three fully labeled sessions: every hold labeled, "Not a pose"
= false detection, uncovered time = no hold.

| Session | Date | Videos | Length | Frame sizes | Holds | With pose | Manual crops | "Not a pose" |
|---|---|---|---|---|---|---|---|---|
| S1 | 2025-04-21 | 1 | 68 min | 1080×1120 | 93 | 91 | 39 | 12 |
| S2 | 2025-08-28 | 7 | 44 min | 1080×1120, 3040×1960 | 56 | 52 | 14 | 1 |
| S3 | 2026-10-10 | 2 | 52 min | 1374×948, 1140×954 | 95 | 93 | 15 | 1 |

**Overlap with the committed fixtures.** S1 *is* the outdoor fixture (67.6 min, threshold 3.1249 in
both). S2's 7.6 min clip is the finishing fixture, analysed again (1831 samples in both; threshold
1.3703 vs 1.3734). Numbers below count each video once (from the export). The fixtures are used
only as the pass/fail checks the rules require and, for S1, for the tiny frames at its pre-merge
best frames (never committed in any other form).

Reproduce: `npm run research -- research/b1-detection.ts --list` (likewise `b2-naming.ts`,
`b3-crop.ts`); outputs in `research/out/`. The scripts import `src/` through Vite's module runner
(`research/run.mjs`, no extra dependency).

Edit cost (`labeling/evaluate.ts`) = 2 · missed + splits + merges + false detections.

## B1 — Hold finding

### Where the edits come from (current defaults)

| Session | Holds | Candidates | Missed | Split | Merge | False | Edit cost |
|---|---|---|---|---|---|---|---|
| S1 | 93 | 108 | 1 | 7 | 11 | 11 | 31 |
| S2 | 56 | 53 | 1 | 8 | 8 | 0 | 18 |
| S3 | 95 | 97 | 8 | 5 | 15 | 0 | 36 |
| All | 244 | 258 | 10 | 20 | 34 | 11 | **85** |

| Edit: cause (from C/m around it) | S1 | S2 | S3 | All |
|---|---|---|---|---|
| merge: sway above the threshold inside a hold (gap 1.25–13.5 s, C peak 1.04–1.48 × thr) | 4 | 7 | 8 | 19 |
| merge: posture change inside a hold (C peak ≥ 1.5 × thr: Prasarita D, Kurmasana, Garbha Pindasana, …) | 7 | 1 | 7 | 15 |
| split: look-alike neighbours, C stays below the threshold (UHP B/C, Paschimottanasana A/B/C, Sarvangasana/Halasana, Marichyasana C R/L) | 7 | 0 | 4 | 11 |
| split: single-still clip rule (a 282 s clip with 7 holds and an 84 s clip with 3 × Urdhva Dhanurasana became one candidate each) | 0 | 8 | 0 | 8 |
| split: change < 1 s above the threshold (joined gap) | 0 | 0 | 1 | 1 |
| false: vinyasa fragment < 20 s between holds (all dismissed in review) | 10 | 0 | 0 | 10 |
| false: after the last hold | 1 | 0 | 0 | 1 |
| missed: still only in pieces < 6 s (short holds of 6–12 s, S3 is a faster practice) | 0 | 1 | 5 | 6 |
| missed: sway above the threshold (Prasarita B, two Urdhva Dhanurasana reps) | 1 | 0 | 2 | 3 |
| missed: shorter than 6 s (Supta Padangusthasana B L, 3.8 s) | 0 | 0 | 1 | 1 |

(The two clips are one candidate each because they are ≤ 300 s with p99/p50 ≤ 4. Their p99/p50 is 1.96–3.16, the same as
single-hold clips (1.92–2.31), so a stricter spread does not separate them; with the rule off for
short clips the cost stays the same (6 and 2), because inside a short clip the p55 threshold marks
sway as movement. The review's "Template expects k holds · Split" covers these in one tap.)

Every one of the 34 merges was blocked by the similar-merge's distance **cap**
(0.45 × the median neighbour distance), most also by the motion condition.

### Device lab, default grid (144 sets, exact)

| Set | S1 | S2 | S3 | Total |
|---|---|---|---|---|
| defaults | 31 | 18 | 36 | 85 |
| stillPercentile 50, splitPeakFactor 0.75 | 29 | 19 | 34 | 82 |
| stillPercentile 50 | 30 | 19 | 35 | 84 |
| splitPeakFactor 0.75 | 31 | 18 | 35 | 84 |

Leave one session out: S1 → stillPercentile 60 + split 0.75 (40 vs 31), S2 → 20 vs 18,
S3 → 34 vs 36. **Not better in every session**; rolling thresholds and hysteresis never reach the
top 10.

### Similar-merge parameters, replayed offline (exact)

The export's merge inputs (best-frame distance and gap motion for every pre-merge pair ≤ 120 s
apart) let `findCandidates` replay the merge without frames (`FrameAccess.distance`). 9 of 10
videos replay bit for bit; in S1 one run starts 4 s earlier (float16 rounding of C moves the
threshold from 3.12488 to 3.125).

| Factor | Cap | S1 | S2 | S3 | Total | Outdoor fixture own (≥ 80) | Finishing fixture (9/9) |
|---|---|---|---|---|---|---|---|
| 2 | 0.45 (today) | 31 | 18 | 36 | 85 | 80 ✓ | 9 ✓ |
| 2 | 0.8 | 31 | 16 | 34 | 81 | 78 ✗ | 9 ✓ |
| 2.5 | 1.2 | 28 | 15 | 32 | 75 | 78 ✗ | 9 ✓ |
| 3 | 1.2 – ∞ | 28 | 15 | 32 | 75 | 77 ✗ | 9 ✓ |

Loosening the cap fixes 11 sway merges and 4 vinyasa fragments but merges 5 pairs of different
look-alike asanas (UHP A/B R and L, Dandasana/Paschimottanasana A, Supta Padangusthasana A/B R,
Urdhva Padmasana/Pindasana): −10 edits, but the outdoor fixture falls below its floor of 80 own
holds, and leave one session out over factor × cap does not lower S1 (31 = defaults). A variant
that applies the cap only across a clear C peak (tested, removed again) fails the fixture the
same way: from 1.2 × threshold the outdoor fixture already drops to 79.

**Why pixel signals cannot do better here.** On S1's committed frames, best frames of two pieces
of the *same* hold differ more (mean |a − b| median 6.3, range 4.2–9.4) than many *different*
holds (p10 4.0; Navasana reps 1.8–3.5). AUC (a different-hold pair further apart than a same-hold
pair) = 0.58 raw, 0.55 brightness-centred — barely better than chance. C alone does not separate
either: among short low-peak gaps between still runs, about 2.5 lie inside a hold for every one
between two holds. The pieces of a hold differ because the posture really changes (hands, binds,
entering and leaving), and look-alike neighbours really look alike.

`minHoldS` (exact replay): 6.5 / 7 save S1's vinyasa fragments (31 → 29 / 26) but miss S3's short
holds (36 → 37 / 40). 6 stays.

**Decision: no default changes for detection** (no set lowers the edit cost in every held-out
session while both fixtures pass). No refined lab grid needed: the variants a grid could add
(threshold, hysteresis, split, merge) are covered above, exactly. The remaining edits need
semantic evidence (what the asana is), which is B2's pose.

## B2 — Asana naming

### Suggestions today, replayed top to bottom (other sessions as history)

| Session | Holds | Top 1 | Top 3 |
|---|---|---|---|
| S1 | 93 | 94 % | 98 % |
| S2 | 56 | 80 % | 91 % |
| S3 | 95 | 94 % | 97 % |
| All | 244 | **91 %** | **96 %** |

| Not the top suggestion: cause | Count | of which not in top 3 |
|---|---|---|
| skipped template entries (e.g. no Parsvottanasana) | 10 | 3 |
| first hold of a new video after a break | 6 | 3 |
| other order than the template (UHP B L before A L, Dandasana after Paschimottanasana A) | 4 | 4 |
| fewer reps than usual (7 of 8 sun-salutation down dogs) | 3 | 0 |

### Pose classifier (world landmarks; leave one session out; 236 holds)

Features: hip-centred, scaled by the torso length, rotated about the vertical axis to a canonical
facing; a mirrored copy (left ↔ right) for the other side; 9 joint angles
(`research/lib/pose.ts`). Nearest training sample per (asana, side) class.

| Setting | Asana top 1 | top 3 | Family | Letter (family right) | Side (asana given) |
|---|---|---|---|---|---|
| nearest sample, angles 0.5 | 61 % | 79 % | 68 % | 78 % (79) | 77 % (106) |
| mean of 2 nearest, angles 0.5 | 61 % | 79 % | 69 % | 77 % (73) | 76 % (106) |
| nearest sample, no angles | 58 % | 80 % | 67 % | 75 % (77) | 77 % (106) |

Confusions are seated forward folds (Janu Sirsasana A/B/C → Tiryang Mukha Eka Pada
Paschimottanasana 14×, Paschimottanasana B/C 4×), UHP letters (5×), Supta Padangusthasana B → A
(2×). The MediaPipe posture class agrees with the catalog in 116 of 120 holds but is missing on
103; feeding it into today's look-ahead changes top 1 by +2 holds only.

### Whole-session alignment (Viterbi over template entries)

States = (entry, reps used); costs: skipped entry 1, fewer reps 0.5, extra rep 1.5, going back 4,
"no hold" 3, skips at the start or after a new video 0.05 each; emission = weight × (distance to
the entry's pose class − the hold's nearest class distance), classes from the other sessions
(`research/lib/align.ts`).

| Zero touch: every card takes its first suggestion | S1 | S2 | S3 | All |
|---|---|---|---|---|
| suggestions today (greedy template order) | 10 % | 0 % | 14 % | 9 % |
| alignment, no pose | 10 % | 0 % | 14 % | 9 % |
| pose only | 52 % | 59 % | 54 % | 54 % |
| **alignment + pose (weight 2)** | 88 % | 88 % | 91 % | **89 %** |
| alignment + pose (weight 5) | 87 % | 88 % | 86 % | 87 % |

Today one deviation (7 instead of 8 down dogs, a recording that starts at UHP) shifts every later
card; pose evidence re-synchronises. On the detector's raw candidates (false detections, splits
and merges included; a candidate's pose = its hold's still, an estimate) zero-touch is 15 % today
vs 60–67 % with alignment + pose.

| Top to bottom, correcting as you go (top 1 / top 3) | S1 | S2 | S3 | All |
|---|---|---|---|---|
| suggestions today | 94 / 98 % | 80 / 91 % | 94 / 97 % | 91 / 96 % |
| alignment + pose (weight 2), min-marginals | 91 / 98 % | 88 / 98 % | 92 / 97 % | 91 / 98 % |
| alignment, no pose | 91 / 97 % | 77 / 91 % | 92 / 96 % | 88 / 95 % |

**Result.** Pose helps clearly where corrections are not made card by card: a "confirm all
suggestions" flow would leave ~11 % of the holds to fix instead of confirming every card. Card by
card, today's template order is already at 91 % top 1; alignment + pose keeps that and raises
top 3 to 98 %. Without pose, alignment does not win (88 / 95 %), so nothing changes in `labeling`
yet: every winning variant needs a pose for each **open candidate**, which the app does not have
(stills exist only after labeling) — see the proposal below.

## B3 — Auto-crop

Boxes recomputed from the exported landmarks (the pose re-run on each stored still — the path a
`CROP_VERSION` bump takes). The stored auto crops differ from such a re-run by more than 0.005 in
96 of 235 holds (up to 0.15): capture runs MediaPipe on a preview of the decoded frame, re-crop on
the stored JPEG, and the lite model is sensitive to the difference.

| Side | Manual beyond auto | Median | p75 | Max |
|---|---|---|---|---|
| left | 24 | −1 % | 5 % | 48 % |
| right | 33 | 2 % | 9 % | 36 % |
| top | 41 | 9 % | 16 % | 84 % |
| bottom | 28 | 0 % | 6 % | 66 % |

(Extent in units of the auto box's width or height.) Contained today: **16 of 66** manual crops.

| Cause (per side beyond auto) | Count |
|---|---|
| taste / composition: no body part at that edge (31 of them on top: headroom) | 49 |
| small (≤ 10 % of the box) | 20 |
| toes beyond the foot landmarks | 6 |
| fingers beyond the hand landmarks | 5 |
| detection error (boxes barely overlap) | 3 |
| low-visibility landmark dropped | 0 (one hold has low-visibility feet outside, not on a side the user extended) |

Fit (2700 geometries: pad, headroom, hand and toe reach, head size, minimum visibility; most
manual crops contained with the median auto area ≤ 1.2 × today's):

| Held out | Fitted on the other two | Contained today | Contained with the fit | Median area ratio |
|---|---|---|---|---|
| S1 | pad 0.18, padTop 0.05, footReach 0.5 | 11 of 39 | 24 of 39 | 1.21 |
| S2 | pad 0.18, padTop 0.05, handReach 1.5 | 2 of 12 | 6 of 12 | 1.18 |
| S3 | pad 0.18, padTop 0.05 | 3 of 15 | 5 of 15 | 1.15 |

**Adopted** (fit on all sessions): `pad` 0.15 → 0.18, new `padTop` 0.05 (headroom), new
`footReach` 0.5 (toes past the foot index, away from the heel); visibility stays 0.3. Contained
**37 of 66** (S1 24/39, S2 8/12, S3 5/15), median area ratio 1.199. `CROP_VERSION` 3: every
hold is cropped again from its still on the next start. `src/crop/__fixtures__/crops.json`
(landmarks, manual boxes, aspect — no images) with `crop/fit.test.ts` at the floor of 37.

The remaining 29 are mostly composition (headroom over seated folds; 28 of the 66 manual crops
use a preset aspect, 18 of them 3:2); covering them would need much larger boxes.

## Proposal — needs your decision

**Compact pose per candidate and hold.** Optional fields, no migration, backups carry them
(analyses and holds are already in `backup.json`):

```ts
interface CompactPose {
  v: 1;
  /** World landmarks (x, y, z in metres) of the 15 body joints used, float16 little-endian, base64 (120 chars). */
  world: string;
  /** Their visibilities × 255, uint8, base64 (20 chars). */
  vis: string;
  posture: PostureClass | null;
}
ReviewCandidate.pose?: CompactPose   // from the candidate's best frame, after analysis
Hold.pose?: CompactPose              // from the hold's still, at capture / re-crop
```

≈ 150 bytes per candidate (≈ 15 KB per session). Filled by the capture worker: candidates right
after analysis while the file is attached (exact frame → 640 px preview → MediaPipe, ≈ 0.2–0.4 s
each, ≈ 30–40 s per 70 min session in the background), holds whenever their still is captured or
re-cropped (existing holds: from the stored stills, no video needed). With it, `suggest()` keeps
its API and top-3 behaviour but ranks by the alignment above when poses are present, and the
review can offer "Confirm all suggestions".

Should I add these two fields?
