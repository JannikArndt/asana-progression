# Asana Progression

Finds the moments where yoga poses are held in practice videos, lets you label them fast, and
shows each asana's progression across sessions. Runs entirely on the iPhone, in the browser —
no uploads, no backend.

**App:** https://jannikarndt.github.io/asana-progression/ (Safari → Share → Add to Home Screen)

## Status

Milestones 1–5 are done: import a video and watch the posture-change graph draw itself while it
is decoded; label the detected holds with one tap (suggestions follow a sequence template such as
the Primary series, or your recent practice); fix them up (choose frame, split, merge, add missed
holds); capture a still and a short clip per hold, auto-cropped to the body; follow each asana's
progression as a feed, grid, side-by-side comparison or flipbook; edit the asana catalog and
templates; back up everything to one ZIP file and restore it. Open: verification on the iPhone.

## Development

```sh
npm ci
npm run dev
npm test && npm run check
npm run test:e2e
```

See [CLAUDE.md](CLAUDE.md) for architecture, the detection algorithm and design decisions.
